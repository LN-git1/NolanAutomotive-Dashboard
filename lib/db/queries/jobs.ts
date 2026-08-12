import 'server-only';

import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs, type JobStatus } from '../schema';

/**
 * All job reads go through here so the soft-delete filter is applied in exactly
 * one place. A deleted job must never appear in a list, a search, the Invoicer
 * picker, or an export.
 */

const notDeleted = isNull(jobs.deletedAt);

export interface JobFilters {
  q?: string;
  status?: JobStatus | 'all';
}

function searchCondition(q: string | undefined): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;

  const pattern = `%${term}%`;
  return or(
    ilike(jobs.jobNumber, pattern),
    ilike(jobs.customerName, pattern),
    ilike(jobs.vehicleRegistration, pattern),
  );
}

export async function listJobs(filters: JobFilters = {}) {
  const conditions: (SQL | undefined)[] = [notDeleted, searchCondition(filters.q)];

  if (filters.status && filters.status !== 'all') {
    conditions.push(eq(jobs.status, filters.status));
  }

  return db
    .select()
    .from(jobs)
    .where(and(...conditions.filter(Boolean as unknown as (v: SQL | undefined) => v is SQL)))
    .orderBy(desc(jobs.createdAt))
    .limit(500);
}

export async function getJob(jobId: string) {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), notDeleted))
    .limit(1);

  return rows[0] ?? null;
}

export async function getJobWithAttachments(jobId: string) {
  return db.query.jobs.findFirst({
    where: and(eq(jobs.id, jobId), notDeleted),
    with: { attachments: true, invoices: true },
  });
}

/** Jobs by status, newest first — used by the Overview lists. */
export async function listJobsByStatus(status: JobStatus, limit = 10) {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, status), notDeleted))
    .orderBy(desc(jobs.updatedAt))
    .limit(limit);
}

/**
 * Candidates for the Invoicer picker. Completed jobs are the normal case, but
 * anything not yet paid is allowed so the owner is never blocked by a job whose
 * status they forgot to advance.
 */
export async function listInvoiceableJobs() {
  return db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      vehicleRegistration: jobs.vehicleRegistration,
      status: jobs.status,
    })
    .from(jobs)
    .where(and(notDeleted, sql`${jobs.status} <> 'paid'`))
    .orderBy(sql`CASE WHEN ${jobs.status} = 'completed' THEN 0 ELSE 1 END`, desc(jobs.updatedAt))
    .limit(300);
}

/** Invoiced-but-unpaid jobs with their invoice, for Awaiting Payments. */
export async function listAwaitingPayment() {
  return db
    .select({
      job: jobs,
      invoice: invoices,
    })
    .from(jobs)
    .leftJoin(invoices, eq(invoices.jobId, jobs.id))
    .where(and(eq(jobs.status, 'invoiced'), notDeleted))
    .orderBy(desc(jobs.updatedAt));
}

export async function countJobsByStatus() {
  const rows = await db
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(notDeleted)
    .groupBy(jobs.status);

  const counts: Record<JobStatus, number> = {
    new: 0,
    active: 0,
    completed: 0,
    invoiced: 0,
    paid: 0,
  };

  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}
