import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs } from '../schema';
import { MONTH_NAMES } from './schedule';

/**
 * "Earned" is cash-basis, not accrual: only invoices whose job is `paid`
 * count, never every non-voided invoice. Jobs carry no `paidAt` timestamp
 * (only `supplierBills.paidAt` exists, for the other side of the business),
 * so there is no exact "date collected" anywhere in the schema either way.
 *
 * Every query below filters `voidedAt IS NULL`, `status = 'paid'`, AND
 * `deletedAt IS NULL` — the last one because `jobs`' own doc comment requires
 * every list query to filter soft-deletes, and a soft-deleted job's paid
 * invoice must not count toward money the business claims to have earned.
 */
const EARNED_INVOICE = and(isNull(invoices.voidedAt), eq(jobs.status, 'paid'), isNull(jobs.deletedAt));

/**
 * The date a job is grouped/filtered by: `dueDate` (when the work itself was
 * due), not `invoices.issueDate` (when the paperwork happened to be
 * generated). A job worked in June invoiced weeks later in August should
 * still land in June's earnings. `dueDate` is nullable — a job that never had
 * one set falls back to its invoice's `issueDate`, the next-best date
 * available, so nothing is silently dropped from the monthly breakdown.
 */
const EARNED_DATE = sql`COALESCE(${jobs.dueDate}, ${invoices.issueDate})`;

export interface EarningsMonth {
  /** `YYYY-MM`, used as both the React key and the lazy-fetch parameter. */
  key: string;
  label: string;
  totalCents: number;
  invoiceCount: number;
}

export interface EarningsSummary {
  allTimeCents: number;
  /** Trailing 30-day sum divided by 30 — average earned per day, not a monthly average. */
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
        allTimeCents: sql<string>`COALESCE(SUM(${invoices.grandTotal}) * 100, 0)::bigint`,
        last30DaysCents: sql<string>`COALESCE(SUM(${invoices.grandTotal}) FILTER (WHERE ${EARNED_DATE} >= CURRENT_DATE - INTERVAL '30 days') * 100, 0)::bigint`,
      })
      .from(invoices)
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_INVOICE),
    db
      .select({
        monthKey: sql<string>`to_char(date_trunc('month', ${EARNED_DATE}), 'YYYY-MM')`,
        totalCents: sql<string>`COALESCE(SUM(${invoices.grandTotal}) * 100, 0)::bigint`,
        invoiceCount: sql<number>`COUNT(*)::int`,
      })
      .from(invoices)
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_INVOICE)
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
  grandTotal: string;
}

/** Fetched only when a month is actually expanded — never on initial page load. */
export async function getEarningsMonthInvoices(monthKey: string): Promise<EarningsMonthInvoice[]> {
  return db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      jobId: invoices.jobId,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      grandTotal: invoices.grandTotal,
    })
    .from(invoices)
    .innerJoin(jobs, eq(invoices.jobId, jobs.id))
    .where(and(EARNED_INVOICE, sql`to_char(date_trunc('month', ${EARNED_DATE}), 'YYYY-MM') = ${monthKey}`))
    .orderBy(EARNED_DATE);
}
