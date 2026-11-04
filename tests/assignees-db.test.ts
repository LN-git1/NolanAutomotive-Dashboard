import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Per-person earnings against a real Postgres: the JOINs, the month basis and
 * the soft-delete / void filters can't be shown by a mock. Skipped without
 * TEST_DATABASE_URL, like the other database tests.
 *
 * Fixtures live in 2031-02 so they cannot collide with real or other tests' data.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const MONTH = '2031-02';
const DUE = '2031-02-10';

describe.skipIf(!TEST_DATABASE_URL)('assignee earnings', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let s: typeof import('@/lib/db/schema');
  let q: typeof import('@/lib/db/queries/assignees');
  let getEarningsSummary: (typeof import('@/lib/db/queries/earnings'))['getEarningsSummary'];

  const lee = randomUUID();
  const sam = randomUUID();
  const gone = randomUUID();
  const jobIds: string[] = [];

  async function job(opts: { assignees: string[]; pay: string; deleted?: boolean; voided?: boolean }) {
    const id = randomUUID();
    const invId = randomUUID();
    jobIds.push(id);
    await db.insert(s.jobs).values({
      id,
      jobNumber: `TEST-${id.slice(0, 8)}`,
      status: 'paid',
      customerName: 'Assignee Test',
      vehicleRegistration: 'TEST-REG',
      dueDate: DUE,
      deletedAt: opts.deleted ? new Date() : null,
    });
    await db.insert(s.invoices).values({
      id: invId,
      invoiceNumber: `TEST-INV-${invId.slice(0, 8)}`,
      jobId: id,
      issueDate: DUE,
      labourSubtotal: opts.pay,
      partsSubtotal: '0.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: opts.pay,
      totalParts: '0.00',
      grandTotal: opts.pay,
      parts: [],
      pdfStoragePath: `test/${invId}.pdf`,
      voidedAt: opts.voided ? new Date() : null,
    });
    await db.insert(s.payments).values({ invoiceId: invId, amount: opts.pay });
    if (opts.assignees.length > 0) {
      await db
        .insert(s.jobAssignees)
        .values(opts.assignees.map((assigneeId) => ({ jobId: id, assigneeId })));
    }
    return id;
  }

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    s = await import('@/lib/db/schema');
    q = await import('@/lib/db/queries/assignees');
    ({ getEarningsSummary } = await import('@/lib/db/queries/earnings'));

    await db.insert(s.assignees).values([
      { id: lee, name: 'Test Lee' },
      { id: sam, name: 'Test Sam' },
      { id: gone, name: 'Test Former', archivedAt: new Date() },
    ]);

    await job({ assignees: [lee], pay: '1000.00' }); //            Lee alone
    await job({ assignees: [lee, sam], pay: '600.00' }); //        shared 300/300
    await job({ assignees: [gone], pay: '200.00' }); //            archived person
    await job({ assignees: [], pay: '70.00' }); //                 unassigned
    await job({ assignees: [sam], pay: '999.00', deleted: true }); // soft-deleted job: excluded
    await job({ assignees: [sam], pay: '888.00', voided: true }); //  voided invoice: excluded
  });

  afterAll(async () => {
    // Only this file's own rows, by id. Invoices reference jobs without a
    // cascade, so they go first (payments and job_assignees cascade).
    await db.delete(s.invoices).where(inArray(s.invoices.jobId, jobIds));
    await db.delete(s.jobs).where(inArray(s.jobs.id, jobIds));
    await db.delete(s.assignees).where(inArray(s.assignees.id, [lee, sam, gone]));
  });

  it('credits each person from cash received, splitting shared jobs equally', async () => {
    const { months } = await q.getAssigneeEarnings();
    const month = months.find((m) => m.key === MONTH);
    expect(month).toBeDefined();

    const by = Object.fromEntries(month!.people.map((p) => [p.name, p.cents]));
    expect(by['Test Lee']).toBe(130_000); // 1000 + half of 600
    expect(by['Test Sam']).toBe(30_000); //  other half of 600; deleted/voided jobs excluded
    expect(by['Test Former']).toBe(20_000);
    expect(by['Unassigned']).toBe(7_000);
  });

  it('flags archived people as former but keeps their name', async () => {
    const { months } = await q.getAssigneeEarnings();
    const former = months.find((m) => m.key === MONTH)!.people.find((p) => p.name === 'Test Former');
    expect(former?.archived).toBe(true);
  });

  it('adds up to exactly the existing Earnings total for the same month', async () => {
    const [{ months }, summary] = await Promise.all([
      q.getAssigneeEarnings(),
      getEarningsSummary(),
    ]);
    const people = months.find((m) => m.key === MONTH)!;
    const earnings = summary.months.find((m) => m.key === MONTH)!;
    expect(people.totalCents).toBe(earnings.totalCents);
    expect(people.totalCents).toBe(187_000);
  });

  it('lists a job’s people including archived ones, and only active people for the picker', async () => {
    const withFormer = jobIds[2]!;
    const onJob = await q.listJobAssignees(withFormer);
    expect(onJob.map((p) => p.name)).toEqual(['Test Former']);
    expect(onJob[0]?.archivedAt).not.toBeNull();

    const active = (await q.listActiveAssignees()).map((p) => p.name);
    expect(active).toContain('Test Lee');
    expect(active).not.toContain('Test Former');
  });

  it('counts jobs per person for Settings', async () => {
    const rows = await q.listAssigneesWithJobCounts();
    expect(rows.find((r) => r.name === 'Test Lee')?.jobCount).toBe(2);
    expect(rows.find((r) => r.name === 'Test Sam')?.jobCount).toBe(3); // incl. deleted + voided jobs' links
  });

  it('will not hard-delete a person who is on a job (archive is the only path)', async () => {
    await expect(db.delete(s.assignees).where(eq(s.assignees.id, lee))).rejects.toThrow();
  });

  it('removes the links when a job is removed', async () => {
    const id = randomUUID();
    jobIds.push(id);
    await db.insert(s.jobs).values({
      id,
      jobNumber: `TEST-${id.slice(0, 8)}`,
      customerName: 'Cascade Test',
      vehicleRegistration: 'TEST-REG',
    });
    await db.insert(s.jobAssignees).values({ jobId: id, assigneeId: sam });

    await db.delete(s.jobs).where(eq(s.jobs.id, id));

    const left = await db.select().from(s.jobAssignees).where(eq(s.jobAssignees.jobId, id));
    expect(left).toHaveLength(0);
  });
});
