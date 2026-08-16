import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs } from '../schema';
import { MONTH_NAMES } from './schedule';

/**
 * "Earned" is cash-basis, not accrual: only invoices whose job is `paid`
 * count, never every non-voided invoice. Jobs carry no `paidAt` timestamp
 * (only `supplierBills.paidAt` exists, for the other side of the business),
 * so `issueDate` is the best available proxy for "when collected" — imprecise
 * for a job paid weeks after issuing, but that imprecision only ever pushes a
 * paid invoice into the wrong month, never counts an unpaid one. Grouping
 * accrual revenue as "Earned" would show money that hasn't actually been
 * received, directly contradicting the Overview page's "Total outstanding"
 * tile — this is the one property that had to hold regardless of the
 * proxy's imprecision.
 *
 * Every query below filters `voidedAt IS NULL`, `status = 'paid'`, AND
 * `deletedAt IS NULL` — the last one because `jobs`' own doc comment requires
 * every list query to filter soft-deletes, and a soft-deleted job's paid
 * invoice must not count toward money the business claims to have earned.
 */
const EARNED_INVOICE = and(isNull(invoices.voidedAt), eq(jobs.status, 'paid'), isNull(jobs.deletedAt));

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
        last30DaysCents: sql<string>`COALESCE(SUM(${invoices.grandTotal}) FILTER (WHERE ${invoices.issueDate} >= CURRENT_DATE - INTERVAL '30 days') * 100, 0)::bigint`,
      })
      .from(invoices)
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_INVOICE),
    db
      .select({
        monthKey: sql<string>`to_char(date_trunc('month', ${invoices.issueDate}), 'YYYY-MM')`,
        totalCents: sql<string>`COALESCE(SUM(${invoices.grandTotal}) * 100, 0)::bigint`,
        invoiceCount: sql<number>`COUNT(*)::int`,
      })
      .from(invoices)
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_INVOICE)
      .groupBy(sql`date_trunc('month', ${invoices.issueDate})`)
      .orderBy(sql`date_trunc('month', ${invoices.issueDate}) DESC`),
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
    .where(
      and(EARNED_INVOICE, sql`to_char(date_trunc('month', ${invoices.issueDate}), 'YYYY-MM') = ${monthKey}`),
    )
    .orderBy(invoices.issueDate);
}
