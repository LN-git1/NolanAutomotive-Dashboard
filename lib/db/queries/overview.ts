import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobAttachments, jobs, payments, supplierBills, suppliers } from '../schema';
import { INVOICE_HAS_BALANCE, REMAINING_CENTS } from './invoice-state';

/**
 * Aggregates for the Overview page.
 *
 * Money is summed in SQL and returned as cents so nothing has to trust
 * JavaScript float arithmetic on the way to the screen.
 */

/**
 * Sum of remaining balances across every live invoice that still owes money.
 *
 * "Owed" is invoice truth, not job-status truth — the same predicate
 * `listAwaitingPayment` filters on, imported rather than rewritten, because
 * this figure is the header above those exact rows and the two must never
 * diverge. It is keyed on neither `status = 'invoiced'` nor `status <> 'paid'`:
 * the owner can move a status at any time, and doing so must neither hide a
 * real debt nor invent one that has already been settled.
 *
 * Each invoice contributes `grandTotal` minus whatever has been paid against
 * it, so a partial payment shrinks the total and a full one removes the
 * invoice from it entirely.
 */
export async function getOutstandingInvoiceTotalCents(): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${REMAINING_CENTS}), 0)::bigint`,
    })
    .from(invoices)
    .innerJoin(jobs, eq(invoices.jobId, jobs.id))
    .where(and(INVOICE_HAS_BALANCE, isNull(jobs.deletedAt), isNull(invoices.voidedAt)));

  return Number(rows[0]?.total ?? 0);
}

/** Sum of supplier bills that have not been marked paid. */
export async function getOwedToSuppliersCents(): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${supplierBills.amount}) * 100, 0)::bigint`,
    })
    .from(supplierBills)
    .where(isNull(supplierBills.paidAt));

  return Number(rows[0]?.total ?? 0);
}

export async function listRecentInvoices(limit = 10) {
  return db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      issueDate: invoices.issueDate,
      grandTotal: invoices.grandTotal,
      sentVia: invoices.sentVia,
      jobId: invoices.jobId,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      /*
        The invoice's own payment state, not `jobs.status`. This column is in a
        table of invoices and reads as "has this been paid" — so it is answered
        from the payments, which is the only source that cannot drift. The job's
        workflow badge lives on the job.
      */
      remainingCents: REMAINING_CENTS,
    })
    .from(invoices)
    .innerJoin(jobs, eq(invoices.jobId, jobs.id))
    // A voided invoice is not a recent piece of business — showing it here would
    // read as money taken. It stays visible on its own job, marked VOID.
    .where(and(isNull(jobs.deletedAt), isNull(invoices.voidedAt)))
    // createdAt, not sentAt: sentAt is null until the invoice is actually
    // sent, and Postgres sorts NULLS FIRST on DESC, which would float
    // unsent invoices to the top of a list meaning "most recently issued".
    .orderBy(desc(invoices.createdAt))
    .limit(limit);
}

export async function listSuppliersWithTotals() {
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      notes: suppliers.notes,
      outstandingCents: sql<string>`COALESCE(SUM(${supplierBills.amount}) FILTER (WHERE ${supplierBills.paidAt} IS NULL) * 100, 0)::bigint`,
      billCount: sql<number>`COUNT(${supplierBills.id})::int`,
    })
    .from(suppliers)
    .leftJoin(supplierBills, eq(supplierBills.supplierId, suppliers.id))
    .groupBy(suppliers.id)
    .orderBy(suppliers.name);
}

/**
 * Row counts for the factory-reset confirmation.
 *
 * Counts EVERY row, including soft-deleted jobs — the reset removes those too,
 * so the number shown has to match what actually gets destroyed.
 */
export async function getResetCounts() {
  const [jobRows, invoiceRows, attachmentRows, supplierRows, billRows, paymentRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(jobs),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices),
    db.select({ n: sql<number>`count(*)::int` }).from(jobAttachments),
    db.select({ n: sql<number>`count(*)::int` }).from(suppliers),
    db.select({ n: sql<number>`count(*)::int` }).from(supplierBills),
    db.select({ n: sql<number>`count(*)::int` }).from(payments),
  ]);

  return {
    jobs: Number(jobRows[0]?.n ?? 0),
    invoices: Number(invoiceRows[0]?.n ?? 0),
    attachments: Number(attachmentRows[0]?.n ?? 0),
    suppliers: Number(supplierRows[0]?.n ?? 0),
    supplierBills: Number(billRows[0]?.n ?? 0),
    payments: Number(paymentRows[0]?.n ?? 0),
  };
}

export async function getSupplierWithBills(supplierId: string) {
  return db.query.suppliers.findFirst({
    where: eq(suppliers.id, supplierId),
    with: {
      bills: {
        orderBy: [desc(supplierBills.billDate)],
      },
    },
  });
}
