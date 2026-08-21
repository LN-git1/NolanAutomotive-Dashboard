import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs, payments } from '../schema';
import { MONTH_NAMES } from './schedule';

/**
 * "Earned" is cash actually received: every `payments` row whose invoice is
 * live and whose job still exists. Deliberately NOT gated on
 * `jobs.status = 'paid'` — a deposit is money in the business's hands the day
 * it lands. Gating on full settlement made a €700 payment against a €1,095
 * invoice contribute nothing, while Overview's "Total outstanding" had already
 * dropped by that same €700: the money left one side of the ledger and arrived
 * nowhere.
 *
 * Owed + Earned reconciles to the invoiced total PROVIDED every transition to
 * `status = 'paid'` records a payment. Both UI paths do — see `changeJobStatus`,
 * which refuses a bare status flip outright. Do not add a third path that
 * writes the status directly, or money will go missing here again.
 *
 * Soft-deleted jobs are excluded because `jobs`' own doc comment requires every
 * list query to filter them, and deleting a job is how test money is removed.
 */
const EARNED_PAYMENT = and(isNull(invoices.voidedAt), isNull(jobs.deletedAt));

/**
 * MONTH attribution: `dueDate` (when the work itself was due), not
 * `invoices.issueDate` (when the paperwork happened to be generated), and not
 * the payment date either. A job worked in June, invoiced and paid in August,
 * belongs in June's earnings. `dueDate` is nullable — a job that never had one
 * set falls back to its invoice's `issueDate`, the next-best date available, so
 * nothing is silently dropped from the breakdown.
 */
const EARNED_DATE = sql`COALESCE(${jobs.dueDate}, ${invoices.issueDate})`;

/**
 * The TRAILING WINDOW keys on when cash arrived, not on the job's due date — a
 * payment recorded today has to move this number even against an old job, which
 * is the whole point of a rolling average. This is the one place the two date
 * bases deliberately differ; the cards say which is which.
 *
 * `- INTERVAL '29 days'` spans exactly 30 calendar days including today,
 * matching the divisor of 30. `'30 days'` would span 31 and understate it.
 */
const LAST_30_DAYS = sql`${payments.paidAt} >= CURRENT_DATE - INTERVAL '29 days'`;

export interface EarningsMonth {
  /** `YYYY-MM`, used as both the React key and the lazy-fetch parameter. */
  key: string;
  label: string;
  totalCents: number;
  invoiceCount: number;
}

export interface EarningsSummary {
  allTimeCents: number;
  /** Trailing 30-day cash divided by 30 — average received per day, not a monthly average. */
  last30DayAvgCents: number;
  /** Most recent first. */
  months: EarningsMonth[];
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

/**
 * Two small aggregate queries, deliberately not a row-level fetch — the panel
 * renders every month collapsed by default, so the initial load never needs
 * per-invoice detail. That only gets fetched on demand, per month, by
 * `getEarningsMonthInvoices`.
 */
export async function getEarningsSummary(): Promise<EarningsSummary> {
  const [totals, monthRows] = await Promise.all([
    db
      .select({
        allTimeCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
        last30DaysCents: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${LAST_30_DAYS}) * 100, 0)::bigint`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_PAYMENT),
    db
      .select({
        monthKey: sql<string>`to_char(date_trunc('month', ${EARNED_DATE}), 'YYYY-MM')`,
        totalCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
        // DISTINCT because two instalments against one invoice are one invoice,
        // not two — this is what keeps `invoiceCount` equal to the number of
        // rows `getEarningsMonthInvoices` returns for the same month.
        invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_PAYMENT)
      .groupBy(sql`date_trunc('month', ${EARNED_DATE})`)
      .orderBy(sql`date_trunc('month', ${EARNED_DATE}) DESC`),
  ]);

  const last30DaysCents = Number(totals[0]?.last30DaysCents ?? 0);

  return {
    allTimeCents: Number(totals[0]?.allTimeCents ?? 0),
    last30DayAvgCents: Math.round(last30DaysCents / 30),
    months: monthRows.map((row) => ({
      key: row.monthKey,
      label: monthLabel(row.monthKey),
      totalCents: Number(row.totalCents),
      invoiceCount: row.invoiceCount,
    })),
  };
}

export interface EarningsMonthInvoice {
  id: string;
  invoiceNumber: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  /** Cash received against this invoice — what this row contributes to the month. */
  receivedCents: number;
  /** The invoice's full total, so a partial can read "€700 of €1,095". */
  grandTotal: string;
}

/** Fetched only when a month is actually expanded — never on initial page load. */
export async function getEarningsMonthInvoices(monthKey: string): Promise<EarningsMonthInvoice[]> {
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      jobId: invoices.jobId,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      grandTotal: invoices.grandTotal,
      receivedCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .innerJoin(jobs, eq(invoices.jobId, jobs.id))
    .where(
      and(EARNED_PAYMENT, sql`to_char(date_trunc('month', ${EARNED_DATE}), 'YYYY-MM') = ${monthKey}`),
    )
    // Grouping by BOTH primary keys lets Postgres' functional-dependency
    // inference allow `jobs.dueDate` in the ORDER BY below.
    .groupBy(invoices.id, jobs.id)
    .orderBy(EARNED_DATE);

  return rows.map((row) => ({ ...row, receivedCents: Number(row.receivedCents) }));
}
