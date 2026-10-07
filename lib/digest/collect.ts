import 'server-only';

import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db/retry';
import {
  errorLog,
  expenses,
  invoices,
  jobAttachments,
  jobs,
  payments,
  supplierLedger,
  suppliers,
  timeOff,
} from '@/lib/db/schema';
import { toCents } from '@/lib/money';

import type { DigestData } from './types';

const TZ = 'Europe/Dublin';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Per-section cap so a busy window cannot produce an enormous email. */
const LIST_LIMIT = 40;

/** Today's date in Dublin as YYYY-MM-DD. */
function dublinDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at);
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Everything the digest shows, for the window `[start, end)`.
 *
 * Privacy: customer names, phones, emails, addresses, registrations and every
 * free-text note are deliberately never selected. The email leaves the business
 * (it goes to the developer), so it carries job/invoice numbers, statuses and
 * amounts only.
 */
export async function collectDigest(start: Date, end: Date): Promise<DigestData> {
  const inWindow = (col: Parameters<typeof gte>[0]) => and(gte(col, start), lt(col, end));
  const read = <T>(label: string, fn: () => Promise<T>) => withDbRetry(`digest:${label}`, fn);

  const todayDublin = dublinDate(end);
  const monthStartDublin = `${todayDublin.slice(0, 8)}01`;
  const soonDublin = dublinDate(new Date(end.getTime() + 2 * DAY_MS));

  // One timed round trip first: it doubles as the "how is the database
  // feeling" figure and fails fast (after retries) if the DB is down.
  const pingStarted = Date.now();
  await read('ping', () => db.execute(sql`SELECT 1`));
  const dbMs = Date.now() - pingStarted;

  const [
    errors,
    jobsCreated,
    jobsUpdated,
    jobsDeleted,
    invoicesIssued,
    invoicesSent,
    invoicesVoided,
    paymentRows,
    expenseRows,
    supplierRows,
    attachmentRows,
    timeOffRows,
    statusCounts,
    overdue,
    dueSoon,
    outstanding,
    collected,
    totals,
    lastActivity,
    oldestUnpaid,
  ] = await Promise.all([
    read('errors', () =>
      db
        .select()
        .from(errorLog)
        .where(inWindow(errorLog.occurredAt))
        .orderBy(desc(errorLog.occurredAt))
        .limit(200),
    ),
    read('jobs-created', () =>
      db
        .select({ jobNumber: jobs.jobNumber, status: jobs.status, priority: jobs.priority, dueDate: jobs.dueDate, at: jobs.createdAt })
        .from(jobs)
        .where(and(inWindow(jobs.createdAt), isNull(jobs.deletedAt)))
        .orderBy(asc(jobs.createdAt))
        .limit(LIST_LIMIT),
    ),
    // "Updated" excludes jobs created in the same window — those are just "added".
    read('jobs-updated', () =>
      db
        .select({ jobNumber: jobs.jobNumber, status: jobs.status, dueDate: jobs.dueDate, at: jobs.updatedAt })
        .from(jobs)
        .where(and(inWindow(jobs.updatedAt), isNull(jobs.deletedAt), lt(jobs.createdAt, start)))
        .orderBy(asc(jobs.updatedAt))
        .limit(LIST_LIMIT),
    ),
    read('jobs-deleted', () =>
      db
        .select({ jobNumber: jobs.jobNumber, at: jobs.deletedAt })
        .from(jobs)
        .where(inWindow(jobs.deletedAt))
        .orderBy(asc(jobs.deletedAt))
        .limit(LIST_LIMIT),
    ),
    read('invoices-issued', () =>
      db
        .select({
          invoiceNumber: invoices.invoiceNumber,
          jobNumber: jobs.jobNumber,
          grandTotal: invoices.grandTotal,
          at: invoices.createdAt,
        })
        .from(invoices)
        .innerJoin(jobs, eq(jobs.id, invoices.jobId))
        .where(inWindow(invoices.createdAt))
        .orderBy(asc(invoices.createdAt))
        .limit(LIST_LIMIT),
    ),
    read('invoices-sent', () =>
      db
        .select({ invoiceNumber: invoices.invoiceNumber, via: invoices.sentVia, at: invoices.sentAt })
        .from(invoices)
        .where(inWindow(invoices.sentAt))
        .orderBy(asc(invoices.sentAt))
        .limit(LIST_LIMIT),
    ),
    read('invoices-voided', () =>
      db
        .select({ invoiceNumber: invoices.invoiceNumber, at: invoices.voidedAt })
        .from(invoices)
        .where(inWindow(invoices.voidedAt))
        .orderBy(asc(invoices.voidedAt))
        .limit(LIST_LIMIT),
    ),
    read('payments', () =>
      db
        .select({
          invoiceNumber: invoices.invoiceNumber,
          jobNumber: jobs.jobNumber,
          amount: payments.amount,
          at: payments.paidAt,
        })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .innerJoin(jobs, eq(jobs.id, invoices.jobId))
        .where(inWindow(payments.paidAt))
        .orderBy(asc(payments.paidAt))
        .limit(LIST_LIMIT),
    ),
    read('expenses', () =>
      db
        .select({
          category: expenses.category,
          amount: expenses.amount,
          reversesId: expenses.reversesId,
          at: expenses.createdAt,
        })
        .from(expenses)
        .where(inWindow(expenses.createdAt))
        .orderBy(asc(expenses.createdAt))
        .limit(LIST_LIMIT),
    ),
    read('supplier-entries', () =>
      db
        .select({
          supplier: suppliers.name,
          kind: supplierLedger.kind,
          amount: supplierLedger.amount,
          at: supplierLedger.createdAt,
        })
        .from(supplierLedger)
        .innerJoin(suppliers, eq(suppliers.id, supplierLedger.supplierId))
        .where(inWindow(supplierLedger.createdAt))
        .orderBy(asc(supplierLedger.createdAt))
        .limit(LIST_LIMIT),
    ),
    read('attachments', () =>
      db
        .select({ jobNumber: jobs.jobNumber, n: sql<number>`count(*)::int` })
        .from(jobAttachments)
        .innerJoin(jobs, eq(jobs.id, jobAttachments.jobId))
        .where(inWindow(jobAttachments.uploadedAt))
        .groupBy(jobs.jobNumber)
        .limit(LIST_LIMIT),
    ),
    read('time-off', () =>
      db
        .select({ startDate: timeOff.startDate, endDate: timeOff.endDate })
        .from(timeOff)
        .where(inWindow(timeOff.createdAt))
        .limit(LIST_LIMIT),
    ),
    read('status-counts', () =>
      db
        .select({ status: jobs.status, n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(isNull(jobs.deletedAt))
        .groupBy(jobs.status),
    ),
    read('overdue', () =>
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            isNull(jobs.deletedAt),
            isNotNull(jobs.dueDate),
            lt(jobs.dueDate, todayDublin),
            ne(jobs.status, 'paid'),
            ne(jobs.status, 'invoiced'),
          ),
        ),
    ),
    read('due-soon', () =>
      db
        .select({ jobNumber: jobs.jobNumber, status: jobs.status, dueDate: jobs.dueDate })
        .from(jobs)
        .where(
          and(
            isNull(jobs.deletedAt),
            isNotNull(jobs.dueDate),
            gte(jobs.dueDate, todayDublin),
            lt(jobs.dueDate, soonDublin),
            ne(jobs.status, 'paid'),
          ),
        )
        .orderBy(asc(jobs.dueDate))
        .limit(LIST_LIMIT),
    ),
    read('outstanding', () =>
      db.execute(sql`
        SELECT count(*)::int AS n,
               COALESCE(SUM(i.grand_total - COALESCE(p.paid, 0)), 0)::text AS owed
        FROM invoices i
        JOIN jobs j ON j.id = i.job_id AND j.deleted_at IS NULL
        LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p
          ON p.invoice_id = i.id
        WHERE i.voided_at IS NULL AND i.grand_total - COALESCE(p.paid, 0) > 0
      `),
    ),
    read('collected', () =>
      db.execute(sql`
        SELECT
          COALESCE(SUM(amount) FILTER (
            WHERE (paid_at AT TIME ZONE ${TZ})::date = ${todayDublin}::date), 0)::text AS today,
          COALESCE(SUM(amount) FILTER (
            WHERE (paid_at AT TIME ZONE ${TZ})::date >= ${monthStartDublin}::date), 0)::text AS month
        FROM payments
      `),
    ),
    read('totals', () =>
      db.execute(sql`
        SELECT (SELECT count(*) FROM jobs WHERE deleted_at IS NULL)::int AS jobs,
               (SELECT count(*) FROM invoices WHERE voided_at IS NULL)::int AS invoices,
               (SELECT count(*) FROM payments)::int AS payments,
               (SELECT count(*) FROM suppliers)::int AS suppliers,
               pg_database_size(current_database())::bigint::text AS db_bytes
      `),
    ),
    read('last-activity', () =>
      db.execute(sql`
        SELECT GREATEST(
          (SELECT max(updated_at) FROM jobs),
          (SELECT max(created_at) FROM invoices),
          (SELECT max(paid_at) FROM payments),
          (SELECT max(created_at) FROM expenses)
        ) AS at
      `),
    ),
    read('oldest-unpaid', () =>
      db.execute(sql`
        SELECT i.invoice_number AS number, i.issue_date::text AS issued
        FROM invoices i
        JOIN jobs j ON j.id = i.job_id AND j.deleted_at IS NULL
        LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p
          ON p.invoice_id = i.id
        WHERE i.voided_at IS NULL AND i.grand_total - COALESCE(p.paid, 0) > 0
        ORDER BY i.issue_date ASC
        LIMIT 1
      `),
    ),
  ]);

  const out = rowsOf<{ n: number; owed: string }>(outstanding)[0];
  const col = rowsOf<{ today: string; month: string }>(collected)[0];
  const tot = rowsOf<{ jobs: number; invoices: number; payments: number; suppliers: number; db_bytes: string }>(totals)[0];
  const last = rowsOf<{ at: string | Date | null }>(lastActivity)[0];
  const oldest = rowsOf<{ number: string; issued: string }>(oldestUnpaid)[0];

  const statusMap: Record<string, number> = { active: 0, completed: 0, invoiced: 0, paid: 0 };
  for (const row of statusCounts) statusMap[row.status] = row.n;

  return {
    windowStart: start,
    windowEnd: end,
    dbMs,
    errors: errors.map((e) => ({
      at: e.occurredAt,
      source: e.source,
      label: e.label,
      message: e.message,
      code: e.code,
    })),
    jobsCreated: jobsCreated.map((j) => ({ ...j })),
    jobsUpdated: jobsUpdated.map((j) => ({ ...j })),
    jobsDeleted: jobsDeleted.map((j) => ({ jobNumber: j.jobNumber, at: j.at as Date })),
    invoicesIssued: invoicesIssued.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      jobNumber: i.jobNumber,
      amountCents: toCents(i.grandTotal),
      at: i.at,
    })),
    invoicesSent: invoicesSent.map((i) => ({ invoiceNumber: i.invoiceNumber, via: i.via, at: i.at as Date })),
    invoicesVoided: invoicesVoided.map((i) => ({ invoiceNumber: i.invoiceNumber, at: i.at as Date })),
    payments: paymentRows.map((p) => ({
      invoiceNumber: p.invoiceNumber,
      jobNumber: p.jobNumber,
      amountCents: toCents(p.amount),
      at: p.at,
    })),
    expenses: expenseRows.map((e) => ({
      category: e.category,
      amountCents: toCents(e.amount),
      isCorrection: e.reversesId !== null,
      at: e.at,
    })),
    supplierEntries: supplierRows.map((s) => ({
      supplier: s.supplier,
      kind: s.kind,
      amountCents: toCents(s.amount),
      at: s.at,
    })),
    attachments: attachmentRows.map((a) => ({ jobNumber: a.jobNumber, count: a.n })),
    timeOff: timeOffRows,
    snapshot: {
      jobsByStatus: statusMap,
      overdueJobs: overdue[0]?.n ?? 0,
      dueSoon,
      outstandingCount: out?.n ?? 0,
      outstandingCents: toCents(out?.owed ?? '0'),
      oldestUnpaid: oldest ? { invoiceNumber: oldest.number, issueDate: oldest.issued } : null,
      collectedTodayCents: toCents(col?.today ?? '0'),
      collectedMonthCents: toCents(col?.month ?? '0'),
      totalJobs: tot?.jobs ?? 0,
      totalInvoices: tot?.invoices ?? 0,
      totalPayments: tot?.payments ?? 0,
      totalSuppliers: tot?.suppliers ?? 0,
      dbBytes: Number(tot?.db_bytes ?? 0),
      lastActivityAt: last?.at ? new Date(last.at) : null,
    },
  };
}
