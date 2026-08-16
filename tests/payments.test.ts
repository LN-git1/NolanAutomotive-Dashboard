import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * `applyPayment` is the transactional core `recordPayment` (the server
 * action) delegates to after its own session check — it locks the job row,
 * recomputes the remaining balance itself (never trusts a caller-supplied
 * figure, even for "pay in full"), and flips the job to `paid` only once the
 * running total reaches `grandTotal`. Testing it directly, not through the
 * action, is deliberate: `recordPayment` calls `requireSession()`, which
 * needs a real Next.js request context `cookies()` doesn't have here — the
 * same reason every other money computation in this suite (Awaiting
 * Payments, Earnings) is tested at the query/logic layer, never through an
 * action wrapper. A mock cannot demonstrate the lock or the real-Postgres
 * arithmetic either way, so this needs a real database and is skipped when
 * TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
 *
 * Void/regenerate refusing an invoice with payments (the two guards added
 * alongside this feature) are API routes, not plain functions — covered by
 * live verification instead of a unit test here, matching how this project
 * verifies route-handler behaviour elsewhere.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('applyPayment', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let jobs: (typeof import('@/lib/db/schema'))['jobs'];
  let invoices: (typeof import('@/lib/db/schema'))['invoices'];
  let applyPayment: (typeof import('@/lib/db/queries/payments'))['applyPayment'];
  let getPaidCentsForInvoice: (typeof import('@/lib/db/queries/payments'))['getPaidCentsForInvoice'];
  let listAwaitingPayment: (typeof import('@/lib/db/queries/jobs'))['listAwaitingPayment'];
  let getOutstandingInvoiceTotalCents: (typeof import(
    '@/lib/db/queries/overview'
  ))['getOutstandingInvoiceTotalCents'];

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ jobs, invoices } = await import('@/lib/db/schema'));
    ({ applyPayment, getPaidCentsForInvoice } = await import('@/lib/db/queries/payments'));
    ({ listAwaitingPayment } = await import('@/lib/db/queries/jobs'));
    ({ getOutstandingInvoiceTotalCents } = await import('@/lib/db/queries/overview'));
  });

  let jobId: string;
  let invoiceId: string;

  /** Fresh €200.00 invoiced job for every test, so tests never interact. */
  async function setUp() {
    jobId = randomUUID();
    invoiceId = randomUUID();

    await db.insert(jobs).values({
      id: jobId,
      jobNumber: `TEST-${jobId.slice(0, 8)}`,
      status: 'invoiced',
      customerName: 'Payments Test',
      vehicleRegistration: 'TEST-REG',
    });

    await db.insert(invoices).values({
      id: invoiceId,
      invoiceNumber: `TEST-INV-${invoiceId.slice(0, 8)}`,
      jobId,
      issueDate: '2026-01-15',
      labourSubtotal: '200.00',
      partsSubtotal: '0.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: '200.00',
      totalParts: '0.00',
      grandTotal: '200.00',
      parts: [],
      pdfStoragePath: `test/payments-${invoiceId}.pdf`,
    });
  }

  afterEach(async () => {
    await db.delete(invoices).where(sql`${invoices.id} = ${invoiceId}`);
    await db.delete(jobs).where(sql`${jobs.id} = ${jobId}`);
  });

  it('a partial payment reduces the remaining balance without flipping status', async () => {
    await setUp();

    const result = await applyPayment(invoiceId, { amountCents: 5000 });
    expect(result.ok).toBe(true);

    expect(await getPaidCentsForInvoice(invoiceId)).toBe(5_000);

    const [job] = await db.select().from(jobs).where(sql`${jobs.id} = ${jobId}`);
    expect(job?.status).toBe('invoiced');

    const rows = await listAwaitingPayment();
    const row = rows.find((r) => r.job.id === jobId);
    expect(row).toBeDefined();
    expect(Number(row!.remainingCents)).toBe(15_000);
  });

  it('enough payments to reach the total auto-flips the job to paid', async () => {
    await setUp();

    await applyPayment(invoiceId, { amountCents: 5000 });
    const second = await applyPayment(invoiceId, { amountCents: 15000 });
    expect(second.ok).toBe(true);

    const [job] = await db.select().from(jobs).where(sql`${jobs.id} = ${jobId}`);
    expect(job?.status).toBe('paid');

    const rows = await listAwaitingPayment();
    expect(rows.some((r) => r.job.id === jobId)).toBe(false);
  });

  it('"paid in full" resolves the amount itself, ignoring any earlier partial payment', async () => {
    await setUp();

    await applyPayment(invoiceId, { amountCents: 5000 });
    const result = await applyPayment(invoiceId, { payInFull: true });
    expect(result.ok).toBe(true);

    // Not 200 -- the server must charge only the remaining 150, computed
    // fresh, never the original grand total.
    expect(await getPaidCentsForInvoice(invoiceId)).toBe(20_000);

    const [job] = await db.select().from(jobs).where(sql`${jobs.id} = ${jobId}`);
    expect(job?.status).toBe('paid');
  });

  it('rejects a payment larger than the remaining balance', async () => {
    await setUp();

    await applyPayment(invoiceId, { amountCents: 5000 });
    const result = await applyPayment(invoiceId, { amountCents: 15100 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/150\.00/);
    // Rejected attempt must not have recorded anything.
    expect(await getPaidCentsForInvoice(invoiceId)).toBe(5_000);
  });

  it('rejects a zero or negative amount', async () => {
    await setUp();

    expect((await applyPayment(invoiceId, { amountCents: 0 })).ok).toBe(false);
    expect((await applyPayment(invoiceId, { amountCents: -1000 })).ok).toBe(false);
  });

  it('rejects a payment against a voided invoice', async () => {
    await setUp();
    await db
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: 'test' })
      .where(sql`${invoices.id} = ${invoiceId}`);

    const result = await applyPayment(invoiceId, { payInFull: true });
    expect(result.ok).toBe(false);
  });

  /**
   * `getOutstandingInvoiceTotalCents` (the header tile) and
   * `listAwaitingPayment` (the rows) used to be two independent
   * computations that could silently disagree — the exact bug the Awaiting
   * Payments page fix closed. Checked against each other rather than a
   * "before vs after" snapshot: both are global aggregates over the whole
   * test database, and a temporal diff would be flaky under Vitest's
   * default cross-file parallelism (another test file's concurrent insert
   * would land inside the window). Comparing the two queries' near-
   * simultaneous results to each other tests the invariant that actually
   * matters and isn't sensitive to what other test files are doing.
   */
  it('getOutstandingInvoiceTotalCents agrees with the sum of remaining balances', async () => {
    await setUp();
    await applyPayment(invoiceId, { amountCents: 8000 });

    const [totalCents, rows] = await Promise.all([
      getOutstandingInvoiceTotalCents(),
      listAwaitingPayment(),
    ]);

    const summedFromRows = rows.reduce((sum, row) => sum + Number(row.remainingCents), 0);
    expect(totalCents).toBe(summedFromRows);

    const myRow = rows.find((row) => row.job.id === jobId);
    expect(myRow).toBeDefined();
    expect(Number(myRow!.remainingCents)).toBe(12_000);
  });
});
