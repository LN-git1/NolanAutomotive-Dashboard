import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { invoices, jobs, payments } from '../schema';

/**
 * Where "invoiced", "awaiting payment" and "paid" are actually decided.
 *
 * These predicates exist because `jobs.status` turned out not to be trustworthy
 * as the answer to "has this been paid?". It is a workflow label the owner can
 * move at any time, and `updateJob` used to write it straight from the job
 * form — so saving an edit on a settled job silently reverted it. J-0019 was
 * invoiced at EUR 450, paid EUR 450 in full, and still read `completed`, which
 * kept it in Awaiting Payments showing EUR 0.00 owed and left the Overview
 * reporting zero paid jobs. Both were faithful renderings of a status column
 * that had been overwritten.
 *
 * So money questions are answered from the money: a live (non-voided) invoice
 * and the payments recorded against it. That is self-healing — however the
 * status column drifts, a fully paid job leaves Awaiting Payments and appears
 * under Paid jobs, because the payments say so. `jobs.status` keeps its job as
 * the workflow badge and nothing more.
 *
 * Every list, total and count that means one of these three things imports from
 * here rather than rolling its own SQL. The header and the rows of Awaiting
 * Payments once disagreed about what "owed" meant by doing exactly that.
 */

/** Received against the invoice row in scope, in cents. Zero when unpaid. */
export const INVOICE_PAID_CENTS: SQL = sql`COALESCE((SELECT SUM(${payments.amount}) * 100 FROM ${payments} WHERE ${payments.invoiceId} = ${invoices.id}), 0)`;

/**
 * `grandTotal` minus what has been paid, floored at zero. A correlated scalar
 * subquery rather than a JOIN + GROUP BY: callers select whole row objects, and
 * grouping by every column of both tables would be far messier.
 */
export const REMAINING_CENTS = sql<string>`GREATEST(${invoices.grandTotal} * 100 - ${INVOICE_PAID_CENTS}, 0)::bigint`;

/** When the last payment landed — the "Paid on" date, and the paid-jobs sort key. */
export const LAST_PAYMENT_AT: SQL = sql`(SELECT MAX(${payments.paidAt}) FROM ${payments} WHERE ${payments.invoiceId} = ${invoices.id})`;

/**
 * The invoice row in scope still has money owed on it.
 *
 * Strictly greater than, so paid-in-full is settled rather than "owes EUR 0" —
 * the precise shape of the J-0019 bug. Comparing in cents (`* 100`) keeps this
 * on the same integer footing as `lib/money.ts`, never float euro.
 */
export const INVOICE_HAS_BALANCE: SQL = sql`${invoices.grandTotal} * 100 > ${INVOICE_PAID_CENTS}`;

/**
 * The invoice row in scope was settled BY MONEY: it asked for something, and
 * that something has been paid.
 *
 * `grandTotal > 0` is load-bearing, not defensive noise. Without it this was
 * simply `NOT INVOICE_HAS_BALANCE`, which is true for an invoice totalling
 * EUR 0.00 against which nobody has paid a cent — so a blank invoice filed its
 * job under Paid jobs, counted on the Overview's Paid tile, and vanished from
 * Jobs, all on money that never moved. That is reachable: `buildInvoice` guards
 * only that the job exists and that the line counts fit the template, and the
 * empty-invoice guard in `/api/invoices/generate` covers the REGENERATE branch
 * only, so a first invoice on a job with no work lines, no rate and no parts is
 * issued at EUR 0.00 without complaint.
 *
 * The route now refuses to issue one, so this is the second of two locks on the
 * same door — and the one that also covers any zero-total row already stored.
 */
export const INVOICE_IS_SETTLED: SQL = sql`${invoices.grandTotal} > 0 AND NOT (${INVOICE_HAS_BALANCE})`;

/**
 * Correlates a live invoice back to the `jobs` row of the enclosing query.
 *
 * Only safe where `jobs` is in the outer FROM and `invoices` is NOT — inside a
 * query that already joins `invoices`, the inner FROM would shadow the outer
 * one. Those queries (`listAwaitingPayment`, `listSettledJobs`) filter the
 * joined invoice row with `INVOICE_HAS_BALANCE`/`INVOICE_IS_SETTLED` directly
 * instead, which is the same test against the same expression.
 */
function jobHasLiveInvoice(condition?: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${invoices}
    WHERE ${invoices.jobId} = ${jobs.id}
      AND ${invoices.voidedAt} IS NULL
      ${condition ? sql`AND (${condition})` : sql.empty()}
  )`;
}

/** Billed, with money still outstanding. Drives Awaiting Payments. */
export const JOB_IS_AWAITING_PAYMENT: SQL = jobHasLiveInvoice(INVOICE_HAS_BALANCE);

/** Billed and settled in full. Drives the Paid jobs page. */
export const JOB_IS_SETTLED: SQL = jobHasLiveInvoice(INVOICE_IS_SETTLED);

/**
 * Work in the workshop — and the catch-all.
 *
 * Deliberately defined as "neither settled nor owed" rather than the more
 * obvious "has no live invoice". Written the obvious way, the three buckets
 * stop partitioning the moment any invoice is neither (a zero-total one was
 * exactly that): such a job would appear in NO Overview tile and in NEITHER
 * job list — lost rather than merely mislabelled, which is worse than the bug
 * this whole change exists to fix.
 *
 * As a complement it cannot leak. Anything the other two buckets do not claim
 * lands here, where the owner can see it and act on it. That is the safe
 * direction to fail in: a job wrongly shown as active is a nuisance, a job
 * wrongly counted as paid is invented income, and a job in no list at all is
 * gone.
 */
export const JOB_IS_PRE_INVOICE: SQL = sql`NOT ${JOB_IS_SETTLED} AND NOT ${JOB_IS_AWAITING_PAYMENT}`;
