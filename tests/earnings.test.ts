import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `getEarningsSummary` / `getEarningsMonthInvoices` are cash-basis (job status
 * `paid` only, never every non-voided invoice) — see the comment on
 * `EARNED_INVOICE` in `lib/db/queries/earnings.ts` for why. A mock cannot
 * demonstrate a JOIN + WHERE + GROUP BY actually behaves this way against
 * Postgres, so like `allocateNumber` and the Awaiting Payments test, this
 * needs a real database and is skipped when TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('getEarningsSummary / getEarningsMonthInvoices', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let jobs: (typeof import('@/lib/db/schema'))['jobs'];
  let invoices: (typeof import('@/lib/db/schema'))['invoices'];
  let getEarningsSummary: (typeof import('@/lib/db/queries/earnings'))['getEarningsSummary'];
  let getEarningsMonthInvoices: (typeof import('@/lib/db/queries/earnings'))['getEarningsMonthInvoices'];
  let toCents: (typeof import('@/lib/money'))['toCents'];

  const MONTH_KEY = '2026-01';
  const ISSUE_DATE = '2026-01-15';
  const DUE_DATE_MONTH_KEY = '2026-03';
  const DUE_DATE = '2026-03-10';

  const jobId = randomUUID();
  const invoiceId = randomUUID();
  const deletedJobId = randomUUID();
  const deletedInvoiceId = randomUUID();
  const dueDateJobId = randomUUID();
  const dueDateInvoiceId = randomUUID();

  async function insertJobAndInvoice(
    id: string,
    invId: string,
    { deletedAt = null, dueDate = null }: { deletedAt?: Date | null; dueDate?: string | null } = {},
  ) {
    await db.insert(jobs).values({
      id,
      jobNumber: `TEST-${id.slice(0, 8)}`,
      status: 'paid',
      customerName: 'Earnings Test',
      vehicleRegistration: 'TEST-REG',
      deletedAt,
      dueDate,
    });

    await db.insert(invoices).values({
      id: invId,
      invoiceNumber: `TEST-INV-${invId.slice(0, 8)}`,
      jobId: id,
      issueDate: ISSUE_DATE,
      labourSubtotal: '200.00',
      partsSubtotal: '0.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: '200.00',
      totalParts: '0.00',
      grandTotal: '200.00',
      parts: [],
      pdfStoragePath: `test/earnings-${invId}.pdf`,
    });
  }

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ jobs, invoices } = await import('@/lib/db/schema'));
    ({ getEarningsSummary, getEarningsMonthInvoices } = await import('@/lib/db/queries/earnings'));
    ({ toCents } = await import('@/lib/money'));

    await insertJobAndInvoice(jobId, invoiceId);
    await insertJobAndInvoice(deletedJobId, deletedInvoiceId, { deletedAt: new Date() });
    await insertJobAndInvoice(dueDateJobId, dueDateInvoiceId, { dueDate: DUE_DATE });
  });

  afterAll(async () => {
    await db
      .delete(invoices)
      .where(sql`${invoices.id} IN (${invoiceId}, ${deletedInvoiceId}, ${dueDateInvoiceId})`);
    await db.delete(jobs).where(sql`${jobs.id} IN (${jobId}, ${deletedJobId}, ${dueDateJobId})`);
  });

  /**
   * The exact bug this fix closes: a job worked (and due) in one month but
   * invoiced weeks later must land in the month it was due, not the month the
   * paperwork happened to be generated.
   */
  it("groups by the job's due date, not the invoice's issue date, when both are set", async () => {
    const summary = await getEarningsSummary();

    const issueMonth = summary.months.find((m) => m.key === MONTH_KEY);
    const dueMonth = summary.months.find((m) => m.key === DUE_DATE_MONTH_KEY);
    expect(dueMonth).toBeDefined();

    const issueMonthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    const dueMonthInvoices = await getEarningsMonthInvoices(DUE_DATE_MONTH_KEY);

    expect(dueMonthInvoices.some((inv) => inv.id === dueDateInvoiceId)).toBe(true);
    expect(issueMonthInvoices.some((inv) => inv.id === dueDateInvoiceId)).toBe(false);
    // Sanity: the January-bucket job from the other test data is unaffected.
    expect(issueMonth?.key ?? MONTH_KEY).toBe(MONTH_KEY);
  });

  /** No due date at all falls back to the invoice's issue date, not silently dropped. */
  it('falls back to issue date when a job has no due date', async () => {
    const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    expect(monthInvoices.some((inv) => inv.id === invoiceId)).toBe(true);
  });

  it('counts a paid job\'s invoice, in both the summary and the month detail', async () => {
    const summary = await getEarningsSummary();
    expect(summary.allTimeCents).toBeGreaterThanOrEqual(20_000);

    const month = summary.months.find((m) => m.key === MONTH_KEY);
    expect(month).toBeDefined();
    expect(month!.totalCents).toBeGreaterThanOrEqual(20_000);
    expect(month!.label).toBe('January 2026');

    const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    expect(monthInvoices.some((inv) => inv.id === invoiceId)).toBe(true);
  });

  it('does not count an active/invoiced/completed job\'s invoice', async () => {
    for (const status of ['active', 'invoiced', 'completed'] as const) {
      await db.update(jobs).set({ status }).where(sql`${jobs.id} = ${jobId}`);

      const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
      expect(monthInvoices.some((inv) => inv.id === invoiceId)).toBe(false);
    }

    await db.update(jobs).set({ status: 'paid' }).where(sql`${jobs.id} = ${jobId}`);
  });

  it('does not count a voided invoice, even if the job is paid', async () => {
    await db
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: 'test' })
      .where(sql`${invoices.id} = ${invoiceId}`);

    const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    expect(monthInvoices.some((inv) => inv.id === invoiceId)).toBe(false);

    await db.update(invoices).set({ voidedAt: null, voidReason: null }).where(sql`${invoices.id} = ${invoiceId}`);
  });

  it('does not count a soft-deleted job\'s paid invoice', async () => {
    const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    expect(monthInvoices.some((inv) => inv.id === deletedInvoiceId)).toBe(false);
  });

  it('agrees with itself: the month rollup total matches the sum of that month\'s invoice detail', async () => {
    const summary = await getEarningsSummary();
    const month = summary.months.find((m) => m.key === MONTH_KEY);
    expect(month).toBeDefined();

    const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    const detailTotal = monthInvoices.reduce((sum, inv) => sum + toCents(inv.grandTotal), 0);

    expect(detailTotal).toBe(month!.totalCents);
    expect(monthInvoices.length).toBe(month!.invoiceCount);
  });
});
