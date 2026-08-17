import 'server-only';

import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs, payments, type JobStatus } from '../schema';

/**
 * `grandTotal` minus whatever has been paid so far against that invoice,
 * clamped at zero. A correlated scalar subquery rather than a JOIN + GROUP BY:
 * `job`/`invoice` below select the full row objects, and grouping by every
 * column of both would be far messier than one aggregate per row.
 */
const REMAINING_CENTS = sql<string>`GREATEST(${invoices.grandTotal} * 100 - COALESCE((SELECT SUM(${payments.amount}) * 100 FROM ${payments} WHERE ${payments.invoiceId} = ${invoices.id}), 0), 0)::bigint`;

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
    with: { attachments: true, invoices: { with: { payments: true } } },
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
 * Candidates for the Invoicer picker.
 *
 * Every job that isn't deleted is offered, including ones already invoiced —
 * because an existing invoice can now be edited and re-sent, so those jobs are a
 * legitimate destination rather than a dead end. The picker badges them and the
 * Invoicer switches to its regenerate path.
 *
 * The invoice content rides along so the Invoicer can show what it is about to
 * stamp without a second round trip. `liveInvoiceId` is null when the only
 * invoice is voided, which is exactly the state that allows a fresh number.
 */
export async function listInvoiceableJobs() {
  const live = db
    .select({
      jobId: invoices.jobId,
      id: sql<string>`${invoices.id}`.as('live_invoice_id'),
      number: sql<string>`${invoices.invoiceNumber}`.as('live_invoice_number'),
    })
    .from(invoices)
    .where(isNull(invoices.voidedAt))
    .as('live');

  return db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      // Carried so the send bar can address the email and the WhatsApp chat
      // without a second round trip once the invoice is issued.
      customerEmail: jobs.customerEmail,
      customerPhone: jobs.customerPhone,
      vehicleRegistration: jobs.vehicleRegistration,
      status: jobs.status,
      labourLines: jobs.labourLines,
      hourlyRate: jobs.hourlyRate,
      labourTotalOverride: jobs.labourTotalOverride,
      parts: jobs.parts,
      otherComments: jobs.otherComments,
      liveInvoiceId: live.id,
      liveInvoiceNumber: live.number,
    })
    .from(jobs)
    .leftJoin(live, eq(live.jobId, jobs.id))
    .where(notDeleted)
    .orderBy(
      // Ready-to-bill work first, then whatever was touched most recently.
      sql`CASE WHEN ${jobs.status} = 'completed' THEN 0 WHEN ${jobs.status} = 'paid' THEN 2 ELSE 1 END`,
      desc(jobs.updatedAt),
    )
    .limit(300);
}

/**
 * The most recent job for a registration, powering the create form's prefill.
 * Reads history rather than introducing a customer table — a repeat visit is
 * just the previous job's details copied forward, and nothing has to stay in sync.
 */
export async function findJobByRegistration(registration: string) {
  const term = registration.trim().toUpperCase();
  if (term === '') return null;

  const rows = await db
    .select({
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      customerPhone: jobs.customerPhone,
      customerEmail: jobs.customerEmail,
      customerAddress: jobs.customerAddress,
      vehicleRegistration: jobs.vehicleRegistration,
      vehicleMake: jobs.vehicleMake,
      vehicleModel: jobs.vehicleModel,
      vehicleYear: jobs.vehicleYear,
      vehicleColor: jobs.vehicleColor,
      vehicleVin: jobs.vehicleVin,
      vehicleMileage: jobs.vehicleMileage,
    })
    .from(jobs)
    .where(and(eq(jobs.vehicleRegistration, term), notDeleted))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Jobs with a live invoice that isn't paid, for Awaiting Payments.
 *
 * Deliberately an INNER join filtered on `status <> 'paid'`, not `status =
 * 'invoiced'`: the owner can move a job's status to anything at any time (the
 * status dropdown allows it unconditionally), and doing so must not make a
 * real, live invoice disappear from what is owed. What actually removes a job
 * from this list is being marked (fully) paid or the invoice being voided —
 * both explicit actions — not an incidental status change made for an
 * unrelated reason. Matches the same logic in `getOutstandingInvoiceTotalCents`.
 *
 * `remainingCents` is the invoice's `grandTotal` minus whatever has already
 * been paid against it — a job stays in this list, at a shrinking amount,
 * through any number of partial payments, and only drops out once the
 * running total reaches the full amount (which is also what flips `status`
 * to `paid` — see `recordPayment`).
 */
export async function listAwaitingPayment() {
  return db
    .select({
      job: jobs,
      invoice: invoices,
      remainingCents: REMAINING_CENTS,
    })
    .from(jobs)
    .innerJoin(invoices, and(eq(invoices.jobId, jobs.id), isNull(invoices.voidedAt)))
    .where(and(ne(jobs.status, 'paid'), notDeleted))
    .orderBy(desc(jobs.updatedAt));
}

export async function countJobsByStatus() {
  const rows = await db
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(notDeleted)
    .groupBy(jobs.status);

  const counts: Record<JobStatus, number> = {
    active: 0,
    completed: 0,
    invoiced: 0,
    paid: 0,
  };

  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}
