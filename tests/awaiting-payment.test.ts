import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `getOutstandingInvoiceTotalCents` / `listAwaitingPayment` are keyed on invoice
 * truth (non-voided, job not `paid`), not on `jobs.status === 'invoiced'` — see
 * the comment on `getOutstandingInvoiceTotalCents`. A mock cannot demonstrate a
 * JOIN + WHERE actually behaves this way against Postgres, so like
 * `allocateNumber` in counters.test.ts, this needs a real database and is
 * skipped when TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
 *
 * DATABASE_URL is pointed at TEST_DATABASE_URL BEFORE importing the query
 * modules: `lib/db/index.ts`'s client is a lazy singleton that reads
 * DATABASE_URL on first query, and this is the only test file that ever
 * touches it, so there is no other file to race with.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('getOutstandingInvoiceTotalCents / listAwaitingPayment', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let jobs: (typeof import('@/lib/db/schema'))['jobs'];
  let invoices: (typeof import('@/lib/db/schema'))['invoices'];
  let getOutstandingInvoiceTotalCents: (typeof import('@/lib/db/queries/overview'))['getOutstandingInvoiceTotalCents'];
  let listAwaitingPayment: (typeof import('@/lib/db/queries/jobs'))['listAwaitingPayment'];

  const jobId = randomUUID();
  const invoiceId = randomUUID();

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ jobs, invoices } = await import('@/lib/db/schema'));
    ({ getOutstandingInvoiceTotalCents } = await import('@/lib/db/queries/overview'));
    ({ listAwaitingPayment } = await import('@/lib/db/queries/jobs'));

    await db.insert(jobs).values({
      id: jobId,
      jobNumber: `TEST-${jobId.slice(0, 8)}`,
      status: 'invoiced',
      customerName: 'Awaiting Payment Test',
      vehicleRegistration: 'TEST-REG',
    });

    await db.insert(invoices).values({
      id: invoiceId,
      invoiceNumber: `TEST-INV-${invoiceId.slice(0, 8)}`,
      jobId,
      issueDate: '2026-01-01',
      labourSubtotal: '100.00',
      partsSubtotal: '0.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: '100.00',
      totalParts: '0.00',
      grandTotal: '100.00',
      parts: [],
      pdfStoragePath: 'test/awaiting-payment.pdf',
    });
  });

  afterAll(async () => {
    await db.delete(invoices).where(sql`${invoices.id} = ${invoiceId}`);
    await db.delete(jobs).where(sql`${jobs.id} = ${jobId}`);
  });

  it('counts a job whose status is invoiced', async () => {
    const total = await getOutstandingInvoiceTotalCents();
    expect(total).toBeGreaterThanOrEqual(10_000);

    const rows = await listAwaitingPayment();
    expect(rows.some((row) => row.job.id === jobId)).toBe(true);
  });

  /**
   * The exact bug this fix closes: moving the job back to `active` (more work
   * needed) must NOT hide a real, live invoice from what the business is owed.
   */
  it('still counts the job after its status moves away from invoiced', async () => {
    const totalBefore = await getOutstandingInvoiceTotalCents();

    await db.update(jobs).set({ status: 'active' }).where(sql`${jobs.id} = ${jobId}`);

    const rows = await listAwaitingPayment();
    const row = rows.find((r) => r.job.id === jobId);
    expect(row).toBeDefined();
    expect(row?.invoice.grandTotal).toBe('100.00');

    const totalAfter = await getOutstandingInvoiceTotalCents();
    expect(totalAfter).toBe(totalBefore);
    expect(totalAfter).toBeGreaterThanOrEqual(10_000);
  });

  it('stops counting once the job is marked paid', async () => {
    await db.update(jobs).set({ status: 'paid' }).where(sql`${jobs.id} = ${jobId}`);

    const rows = await listAwaitingPayment();
    expect(rows.some((row) => row.job.id === jobId)).toBe(false);

    await db.update(jobs).set({ status: 'active' }).where(sql`${jobs.id} = ${jobId}`);
  });

  it('stops counting once the invoice is voided, regardless of job status', async () => {
    await db
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: 'test' })
      .where(sql`${invoices.id} = ${invoiceId}`);

    const rows = await listAwaitingPayment();
    expect(rows.some((row) => row.job.id === jobId)).toBe(false);

    await db.update(invoices).set({ voidedAt: null, voidReason: null }).where(sql`${invoices.id} = ${invoiceId}`);
  });
});
