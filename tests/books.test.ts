import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Books P&L queries against a real Postgres, same reasoning as
 * earnings.test.ts: JOIN + GROUP BY + reversal netting cannot be proven by a
 * mock. Skipped when TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test:run
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('getBooksSummary / getBooksMonthDetail', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let schema: typeof import('@/lib/db/schema');
  let getBooksSummary: (typeof import('@/lib/db/queries/books'))['getBooksSummary'];
  let getBooksMonthDetail: (typeof import('@/lib/db/queries/books'))['getBooksMonthDetail'];

  const MONTH_KEY = '2026-02';
  const EXPENSE_DATE = '2026-02-10';
  const DUE_DATE = '2026-02-12';

  const jobId = randomUUID();
  const invoiceId = randomUUID();
  const supplierId = randomUUID();
  const expenseId = randomUUID();

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    schema = await import('@/lib/db/schema');
    ({ getBooksSummary, getBooksMonthDetail } = await import('@/lib/db/queries/books'));

    await db.insert(schema.jobs).values({
      id: jobId,
      jobNumber: `TEST-${jobId.slice(0, 8)}`,
      status: 'paid',
      customerName: 'Books Test Customer',
      vehicleRegistration: 'TEST-BOOKS-1',
      dueDate: DUE_DATE,
    });
    await db.insert(schema.invoices).values({
      id: invoiceId,
      invoiceNumber: `TEST-INV-${invoiceId.slice(0, 8)}`,
      jobId,
      issueDate: EXPENSE_DATE,
      labourSubtotal: '100.00',
      partsSubtotal: '50.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: '100.00',
      totalParts: '50.00',
      grandTotal: '150.00',
      parts: [],
      pdfStoragePath: 'test/test.pdf',
    });
    await db.insert(schema.payments).values({ invoiceId, amount: '150.00' });
    await db.insert(schema.suppliers).values({ id: supplierId, name: 'Books Test Supplier' });
    await db.insert(schema.supplierLedger).values({
      supplierId,
      kind: 'charge',
      amount: '40.00',
      entryDate: EXPENSE_DATE,
      reference: 'books-test-charge',
    });
    await db.insert(schema.expenses).values({
      id: expenseId,
      expenseDate: EXPENSE_DATE,
      category: 'rent',
      amount: '60.00',
      note: 'books test expense',
      submissionKey: randomUUID(),
    });
  });

  afterAll(async () => {
    await db.delete(schema.payments).where(eq(schema.payments.invoiceId, invoiceId));
    await db.delete(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    await db.delete(schema.jobs).where(eq(schema.jobs.id, jobId));
    await db.delete(schema.supplierLedger).where(eq(schema.supplierLedger.supplierId, supplierId));
    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
    await db.delete(schema.expenses).where(eq(schema.expenses.expenseDate, EXPENSE_DATE));
  });

  it('puts income, supplier charges and expenses in the same month bucket', async () => {
    const summary = await getBooksSummary();
    const month = summary.months.find((entry) => entry.key === MONTH_KEY);
    expect(month).toBeDefined();
    // Income €150.00 in; supplier €40.00 + expense €60.00 = €100.00 out; €50.00 profit.
    expect(month!.incomeCents).toBe(15000);
    expect(month!.outCents).toBe(10000);
    expect(month!.profitCents).toBe(5000);
  });

  it('returns drill-down lines with source links', async () => {
    const detail = await getBooksMonthDetail(MONTH_KEY);
    expect(detail.income.length).toBe(1);
    expect(detail.income[0]!.href).toBe(`/jobs/${jobId}`);
    expect(detail.supplier.length).toBe(1);
    expect(detail.supplier[0]!.href).toBe(`/suppliers/${supplierId}`);
    expect(detail.expenses.length).toBe(1);
    expect(detail.expenses[0]!.cents).toBe(6000);
  });

  it('excludes supplier payments from outgoings (no double-count)', async () => {
    await db.insert(schema.supplierLedger).values({
      supplierId,
      kind: 'payment',
      amount: '40.00',
      entryDate: EXPENSE_DATE,
      reference: 'books-test-payment',
    });
    const summary = await getBooksSummary();
    const month = summary.months.find((entry) => entry.key === MONTH_KEY);
    expect(month!.outCents).toBe(10000);
  });
});
