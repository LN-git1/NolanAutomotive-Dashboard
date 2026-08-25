import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * "Awaiting payment", "paid" and the Overview counts are all keyed on the
 * payments recorded against a live invoice — never on `jobs.status`. A mock
 * cannot demonstrate that a correlated subquery behaves this way against
 * Postgres, so like `allocateNumber` in counters.test.ts this needs a real
 * database and is skipped when TEST_DATABASE_URL is not set.
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

describe.skipIf(!TEST_DATABASE_URL)('awaiting payment / settled, keyed on payments', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let jobs: (typeof import('@/lib/db/schema'))['jobs'];
  let invoices: (typeof import('@/lib/db/schema'))['invoices'];
  let payments: (typeof import('@/lib/db/schema'))['payments'];
  let getOutstandingInvoiceTotalCents: (typeof import('@/lib/db/queries/overview'))['getOutstandingInvoiceTotalCents'];
  let listAwaitingPayment: (typeof import('@/lib/db/queries/jobs'))['listAwaitingPayment'];
  let listSettledJobs: (typeof import('@/lib/db/queries/jobs'))['listSettledJobs'];
  let listJobs: (typeof import('@/lib/db/queries/jobs'))['listJobs'];
  let countJobPipeline: (typeof import('@/lib/db/queries/jobs'))['countJobPipeline'];

  const jobId = randomUUID();
  const invoiceId = randomUUID();

  const isTestJob = (row: { job: { id: string } }) => row.job.id === jobId;

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ jobs, invoices, payments } = await import('@/lib/db/schema'));
    ({ getOutstandingInvoiceTotalCents } = await import('@/lib/db/queries/overview'));
    ({ listAwaitingPayment, listSettledJobs, listJobs, countJobPipeline } = await import(
      '@/lib/db/queries/jobs'
    ));

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
    await db.delete(payments).where(sql`${payments.invoiceId} = ${invoiceId}`);
    await db.delete(invoices).where(sql`${invoices.id} = ${invoiceId}`);
    await db.delete(jobs).where(sql`${jobs.id} = ${jobId}`);
  });

  it('counts an unpaid invoice, and lists the job as open rather than settled', async () => {
    expect(await getOutstandingInvoiceTotalCents()).toBeGreaterThanOrEqual(10_000);

    expect((await listAwaitingPayment()).some(isTestJob)).toBe(true);
    expect((await listSettledJobs()).some(isTestJob)).toBe(false);
    expect((await listJobs({ scope: 'open' })).some((job) => job.id === jobId)).toBe(true);
    expect((await listJobs({ scope: 'settled' })).some((job) => job.id === jobId)).toBe(false);
  });

  /**
   * Moving the job back to `active` (more work needed) must not hide a real,
   * live invoice from what the business is owed.
   */
  it('still counts the job after its status moves away from invoiced', async () => {
    const totalBefore = await getOutstandingInvoiceTotalCents();

    await db.update(jobs).set({ status: 'active' }).where(sql`${jobs.id} = ${jobId}`);

    const row = (await listAwaitingPayment()).find(isTestJob);
    expect(row).toBeDefined();
    expect(row?.invoice.grandTotal).toBe('100.00');
    expect(await getOutstandingInvoiceTotalCents()).toBe(totalBefore);
  });

  /**
   * The inverse of the J-0019 bug, and the reason this list no longer filters
   * `status <> 'paid'`: a status label with no money behind it must not be able
   * to write off a real debt. `changeJobStatus` refuses `paid` outright, so this
   * writes the column directly — the point is that even if something did, the
   * EUR 100 stays owed.
   */
  it('keeps counting a debt even if the status column claims paid', async () => {
    await db.update(jobs).set({ status: 'paid' }).where(sql`${jobs.id} = ${jobId}`);

    expect((await listAwaitingPayment()).some(isTestJob)).toBe(true);
    expect((await listSettledJobs()).some(isTestJob)).toBe(false);
    expect(await getOutstandingInvoiceTotalCents()).toBeGreaterThanOrEqual(10_000);

    await db.update(jobs).set({ status: 'invoiced' }).where(sql`${jobs.id} = ${jobId}`);
  });

  it('shrinks but does not drop out on a partial payment', async () => {
    await db.insert(payments).values({ invoiceId, amount: '40.00' });

    const row = (await listAwaitingPayment()).find(isTestJob);
    expect(row).toBeDefined();
    expect(Number(row?.remainingCents)).toBe(6_000);
    expect((await listSettledJobs()).some(isTestJob)).toBe(false);
  });

  /**
   * J-0019, exactly: invoiced, paid in full, and its status column left saying
   * `completed`. It must leave Awaiting Payments and appear under Paid jobs on
   * the strength of the payments alone. Before this fix it sat in the owed list
   * forever showing EUR 0.00 and never reached the Paid count.
   */
  it('drops out once paid in full, even with a stale status of completed', async () => {
    await db.insert(payments).values({ invoiceId, amount: '60.00' });
    await db.update(jobs).set({ status: 'completed' }).where(sql`${jobs.id} = ${jobId}`);

    expect((await listAwaitingPayment()).some(isTestJob)).toBe(false);
    expect((await listSettledJobs()).some(isTestJob)).toBe(true);

    // And it moves between the two job lists on the same evidence.
    expect((await listJobs({ scope: 'open' })).some((job) => job.id === jobId)).toBe(false);
    expect((await listJobs({ scope: 'settled' })).some((job) => job.id === jobId)).toBe(true);
  });

  it('counts as paid in the Overview pipeline, not as active or invoiced', async () => {
    const before = await countJobPipeline();

    // Removing the final payment must move it back a stage and nowhere else,
    // which is what proves the three buckets are driven by the same evidence.
    await db.delete(payments).where(sql`${payments.amount} = '60.00' AND ${payments.invoiceId} = ${invoiceId}`);
    const after = await countJobPipeline();

    expect(after.paid).toBe(before.paid - 1);
    expect(after.invoiced).toBe(before.invoiced + 1);
    expect(after.active).toBe(before.active);

    await db.insert(payments).values({ invoiceId, amount: '60.00' });
  });

  it('stops counting once the invoice is voided, regardless of job status', async () => {
    await db
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: 'test' })
      .where(sql`${invoices.id} = ${invoiceId}`);

    expect((await listAwaitingPayment()).some(isTestJob)).toBe(false);
    // A voided invoice is not settled business either — the job goes back to
    // being uninvoiced work, free to be invoiced again under a fresh number.
    expect((await listSettledJobs()).some(isTestJob)).toBe(false);
    expect((await listJobs({ scope: 'open' })).some((job) => job.id === jobId)).toBe(true);

    await db
      .update(invoices)
      .set({ voidedAt: null, voidReason: null })
      .where(sql`${invoices.id} = ${invoiceId}`);
  });
});
