import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobAttachments, jobs, payments, supplierLedger, suppliers } from '../schema';
import { INVOICE_HAS_BALANCE, REMAINING_CENTS } from './invoice-state';

/**
 * One supplier account's balance in cents, as an aggregate over the joined
 * ledger rows. Charges add, payments take off.
 *
 * Written as an aggregate over a LEFT JOIN rather than as a correlated
 * subquery, deliberately. Drizzle decides for itself whether to qualify a
 * column with its table name, and in a single-table SELECT it drops the
 * qualification — which silently turns `WHERE supplier_id = id` inside a
 * subquery into a comparison of two columns of the SAME table, matching
 * nothing and quietly returning NULL. A join puts both tables in scope, so
 * every column is qualified and the link cannot be lost.
 */
const BALANCE_CENTS = sql<string>`COALESCE(SUM(
  CASE WHEN ${supplierLedger.kind} = 'payment'
       THEN -${supplierLedger.amount}
       ELSE ${supplierLedger.amount} END
) * 100, 0)::bigint`;

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

/**
 * What the garage still owes its suppliers, across every account.
 *
 * Each account's balance is floored at zero BEFORE the accounts are summed,
 * which is the whole reason this is not one flat sum of charges minus
 * payments. A supplier can be in credit (paying more than has been entered on
 * the account is allowed — see `applySupplierPayment`), and a flat sum would
 * quietly let that credit cancel out a real debt to a different supplier. The
 * tile would then read low, and no screen would show why.
 */
export async function getOwedToSuppliersCents(): Promise<number> {
  const balances = db
    .select({ balanceCents: BALANCE_CENTS.as('balance_cents') })
    .from(suppliers)
    .leftJoin(supplierLedger, eq(supplierLedger.supplierId, suppliers.id))
    .groupBy(suppliers.id)
    .as('supplier_balances');

  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(GREATEST(${balances.balanceCents}, 0)), 0)::bigint`,
    })
    .from(balances);

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

/**
 * One row per supplier with the balance on their account.
 *
 * `balanceCents` is signed, unlike the Overview total above: this is the list
 * you open to see who is owed what, so a supplier holding a credit has to say
 * so on their own line rather than be flattened to zero.
 */
export async function listSuppliersWithTotals() {
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      notes: suppliers.notes,
      balanceCents: BALANCE_CENTS,
      lastEntryDate: sql<string | null>`MAX(${supplierLedger.entryDate})`,
    })
    .from(suppliers)
    .leftJoin(supplierLedger, eq(supplierLedger.supplierId, suppliers.id))
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
  const [jobRows, invoiceRows, attachmentRows, supplierRows, entryRows, paymentRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(jobs),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices),
    db.select({ n: sql<number>`count(*)::int` }).from(jobAttachments),
    db.select({ n: sql<number>`count(*)::int` }).from(suppliers),
    db.select({ n: sql<number>`count(*)::int` }).from(supplierLedger),
    db.select({ n: sql<number>`count(*)::int` }).from(payments),
  ]);

  return {
    jobs: Number(jobRows[0]?.n ?? 0),
    invoices: Number(invoiceRows[0]?.n ?? 0),
    attachments: Number(attachmentRows[0]?.n ?? 0),
    suppliers: Number(supplierRows[0]?.n ?? 0),
    supplierEntries: Number(entryRows[0]?.n ?? 0),
    payments: Number(paymentRows[0]?.n ?? 0),
  };
}

/**
 * One supplier and their whole account history, newest first.
 *
 * Ordered by `createdAt` as well as the entry date, and not by date alone:
 * `bill_date` is a bare DATE, so a purchase and the payment that settles it on
 * the same afternoon tie, and the two would swap places between renders. The
 * page shows these as a running account, where the order of same-day entries
 * is the order they were keyed in.
 */
export async function getSupplierWithEntries(supplierId: string) {
  return db.query.suppliers.findFirst({
    where: eq(suppliers.id, supplierId),
    with: {
      entries: {
        orderBy: [desc(supplierLedger.entryDate), desc(supplierLedger.createdAt)],
      },
    },
  });
}
