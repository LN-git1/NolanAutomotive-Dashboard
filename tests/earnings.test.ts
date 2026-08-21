import { randomUUID } from 'node:crypto';

import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `getEarningsSummary` / `getEarningsMonthInvoices` are cash-basis: they sum the
 * `payments` table, so money counts the day it lands rather than waiting for a
 * job to be fully settled — see the comment on `EARNED_PAYMENT` in
 * `lib/db/queries/earnings.ts` for why. A mock cannot demonstrate a JOIN +
 * WHERE + GROUP BY actually behaves this way against Postgres, so like
 * `allocateNumber` and the Awaiting Payments test, this needs a real database
 * and is skipped when TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test:run
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

/** A plain `YYYY-MM-DD` N days back, for exercising the trailing-30-day window. */
function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

describe.skipIf(!TEST_DATABASE_URL)('getEarningsSummary / getEarningsMonthInvoices', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let jobs: (typeof import('@/lib/db/schema'))['jobs'];
  let invoices: (typeof import('@/lib/db/schema'))['invoices'];
  let payments: (typeof import('@/lib/db/schema'))['payments'];
  let getEarningsSummary: (typeof import('@/lib/db/queries/earnings'))['getEarningsSummary'];
  let getEarningsMonthInvoices: (typeof import('@/lib/db/queries/earnings'))['getEarningsMonthInvoices'];
  let toCents: (typeof import('@/lib/money'))['toCents'];

  const MONTH_KEY = '2026-01';
  const ISSUE_DATE = '2026-01-15';
  const DUE_DATE_MONTH_KEY = '2026-03';
  const DUE_DATE = '2026-03-10';
  const PARTIAL_MONTH_KEY = '2026-05';
  const PARTIAL_DUE_DATE = '2026-05-10';

  const jobId = randomUUID();
  const invoiceId = randomUUID();
  const deletedJobId = randomUUID();
  const deletedInvoiceId = randomUUID();
  const dueDateJobId = randomUUID();
  const dueDateInvoiceId = randomUUID();
  const partialJobId = randomUUID();
  const partialInvoiceId = randomUUID();
  const oldDueJobId = randomUUID();
  const oldDueInvoiceId = randomUUID();

  async function insertJobAndInvoice(
    id: string,
    invId: string,
    {
      deletedAt = null,
      dueDate = null,
      status = 'paid' as const,
      grandTotal = '200.00',
      paymentAmounts = ['200.00'],
    }: {
      deletedAt?: Date | null;
      dueDate?: string | null;
      status?: 'active' | 'completed' | 'invoiced' | 'paid';
      grandTotal?: string;
      paymentAmounts?: string[];
    } = {},
  ) {
    await db.insert(jobs).values({
      id,
      jobNumber: `TEST-${id.slice(0, 8)}`,
      status,
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
      labourSubtotal: grandTotal,
      partsSubtotal: '0.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: grandTotal,
      totalParts: '0.00',
      grandTotal,
      parts: [],
      pdfStoragePath: `test/earnings-${invId}.pdf`,
    });

    // `paidAt` defaults to now(), which is what puts every fixture inside the
    // trailing-30-day window regardless of the job's due date.
    for (const amount of paymentAmounts) {
      await db.insert(payments).values({ invoiceId: invId, amount });
    }
  }

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ jobs, invoices, payments } = await import('@/lib/db/schema'));
    ({ getEarningsSummary, getEarningsMonthInvoices } = await import('@/lib/db/queries/earnings'));
    ({ toCents } = await import('@/lib/money'));

    await insertJobAndInvoice(jobId, invoiceId);
    await insertJobAndInvoice(deletedJobId, deletedInvoiceId, { deletedAt: new Date() });
    await insertJobAndInvoice(dueDateJobId, dueDateInvoiceId, { dueDate: DUE_DATE });

    // A partially-paid job that is NOT `paid` — the exact case that used to count nothing.
    await insertJobAndInvoice(partialJobId, partialInvoiceId, {
      status: 'invoiced',
      dueDate: PARTIAL_DUE_DATE,
      grandTotal: '1000.00',
      paymentAmounts: ['400.00'],
    });

    // Paid TODAY against a job due 60 days ago: must move the 30-day average.
    await insertJobAndInvoice(oldDueJobId, oldDueInvoiceId, {
      status: 'invoiced',
      dueDate: isoDaysAgo(60),
      grandTotal: '500.00',
      paymentAmounts: ['500.00'],
    });
  });

  // `inArray` rather than a raw SQL IN list — the ids are UUID strings and
  // drizzle parameterises them properly. Payments first: they FK to invoices.
  afterAll(async () => {
    const invIds = [invoiceId, deletedInvoiceId, dueDateInvoiceId, partialInvoiceId, oldDueInvoiceId];
    const jobIds = [jobId, deletedJobId, dueDateJobId, partialJobId, oldDueJobId];
    await db.delete(payments).where(inArray(payments.invoiceId, invIds));
    await db.delete(invoices).where(inArray(invoices.id, invIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  });

  /**
   * A job worked (and due) in one month but invoiced weeks later must land in
   * the month it was due, not the month the paperwork happened to be generated.
   */
  it("groups by the job's due date, not the invoice's issue date, when both are set", async () => {
    const summary = await getEarningsSummary();

    const dueMonth = summary.months.find((m) => m.key === DUE_DATE_MONTH_KEY);
    expect(dueMonth).toBeDefined();

    const issueMonthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    const dueMonthInvoices = await getEarningsMonthInvoices(DUE_DATE_MONTH_KEY);

    expect(dueMonthInvoices.some((inv) => inv.id === dueDateInvoiceId)).toBe(true);
    expect(issueMonthInvoices.some((inv) => inv.id === dueDateInvoiceId)).toBe(false);
  });

  /** No due date at all falls back to the invoice's issue date, not silently dropped. */
  it('falls back to issue date when a job has no due date', async () => {
    const monthInvoices = await getEarningsMonthInvoices(MONTH_KEY);
    expect(monthInvoices.some((inv) => inv.id === invoiceId)).toBe(true);
  });

  /** The regression this whole change exists to fix. */
  it('counts a partial payment on a job that is not yet paid', async () => {
    const summary = await getEarningsSummary();
    const month = summary.months.find((m) => m.key === PARTIAL_MONTH_KEY);
    expect(month).toBeDefined();
    expect(month!.totalCents).toBe(40_000);

    const detail = await getEarningsMonthInvoices(PARTIAL_MONTH_KEY);
    const row = detail.find((d) => d.id === partialInvoiceId);
    expect(row).toBeDefined();
    expect(row!.receivedCents).toBe(40_000);
    expect(toCents(row!.grandTotal)).toBe(100_000);
  });

  it('counts an invoice with no payments as nothing, even when the job is paid', async () => {
    const noPayJobId = randomUUID();
    const noPayInvId = randomUUID();
    await insertJobAndInvoice(noPayJobId, noPayInvId, { paymentAmounts: [] });

    const detail = await getEarningsMonthInvoices(MONTH_KEY);
    expect(detail.some((d) => d.id === noPayInvId)).toBe(false);

    await db.delete(invoices).where(inArray(invoices.id, [noPayInvId]));
    await db.delete(jobs).where(inArray(jobs.id, [noPayJobId]));
  });

  /**
   * The reason the trailing window keys on `payments.paidAt` and not on the
   * job's due date: money collected today has to move the average even when the
   * work itself was due months ago.
   */
  it('moves the 30-day average for a payment made today against an old job', async () => {
    const summary = await getEarningsSummary();
    expect(summary.last30DayAvgCents).toBeGreaterThanOrEqual(Math.floor(50_000 / 30));
  });

  it('sums two instalments against one invoice into a single row', async () => {
    const twoJobId = randomUUID();
    const twoInvId = randomUUID();
    await insertJobAndInvoice(twoJobId, twoInvId, {
      grandTotal: '120.00',
      paymentAmounts: ['30.00', '90.00'],
    });

    const detail = await getEarningsMonthInvoices(MONTH_KEY);
    const rows = detail.filter((d) => d.id === twoInvId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.receivedCents).toBe(12_000);

    await db.delete(payments).where(inArray(payments.invoiceId, [twoInvId]));
    await db.delete(invoices).where(inArray(invoices.id, [twoInvId]));
    await db.delete(jobs).where(inArray(jobs.id, [twoJobId]));
  });

  it('does not count a voided invoice', async () => {
    await db
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: 'test' })
      .where(sql`${invoices.id} = ${invoiceId}`);

    const detail = await getEarningsMonthInvoices(MONTH_KEY);
    expect(detail.some((d) => d.id === invoiceId)).toBe(false);

    await db
      .update(invoices)
      .set({ voidedAt: null, voidReason: null })
      .where(sql`${invoices.id} = ${invoiceId}`);
  });

  it("does not count a soft-deleted job's payments", async () => {
    const detail = await getEarningsMonthInvoices(MONTH_KEY);
    expect(detail.some((d) => d.id === deletedInvoiceId)).toBe(false);
  });

  it('agrees with itself: the month rollup matches the sum of that month detail', async () => {
    const summary = await getEarningsSummary();
    const month = summary.months.find((m) => m.key === MONTH_KEY);
    expect(month).toBeDefined();

    const detail = await getEarningsMonthInvoices(MONTH_KEY);
    const detailTotal = detail.reduce((sum, d) => sum + d.receivedCents, 0);

    expect(detailTotal).toBe(month!.totalCents);
    expect(detail.length).toBe(month!.invoiceCount);
  });
});
