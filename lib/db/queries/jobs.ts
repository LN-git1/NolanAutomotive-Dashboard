import 'server-only';

import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs, type JobStatus } from '../schema';
import {
  INVOICE_HAS_BALANCE,
  INVOICE_IS_SETTLED,
  JOB_IS_AWAITING_PAYMENT,
  JOB_IS_PRE_INVOICE,
  JOB_IS_SETTLED,
  LAST_PAYMENT_AT,
  REMAINING_CENTS,
} from './invoice-state';
import { NORMALIZED_REGISTRATION, normalizeRegistration } from './vehicles';

/**
 * All job reads go through here so the soft-delete filter is applied in exactly
 * one place. A deleted job must never appear in a list, a search, the Invoicer
 * picker, or an export.
 */

const notDeleted = isNull(jobs.deletedAt);

/**
 * Which slice of the workshop a list is asking about.
 *
 * `open` and `settled` are complements: together they cover every job exactly
 * once, which is the invariant `tests/awaiting-payment.test.ts` pins down and
 * the reason a job can never fall out of both lists at once.
 *
 * `pre-invoice` is a narrower cut of `open` — work that has not been billed at
 * all. It exists because `/jobs` was showing invoiced work alongside the cars
 * actually in the workshop, so a job Lee had already billed still sat in the
 * list he uses to decide what to do next. Those jobs now live on
 * `/awaiting-payments` and are reachable from here by the search hint.
 *
 * `open` is deliberately left alone rather than redefined: it is the half of
 * the partition, and narrowing it would break the "every job appears somewhere"
 * guarantee that `JOB_IS_PRE_INVOICE`'s own docstring exists to defend.
 */
export type JobScope = 'open' | 'pre-invoice' | 'settled' | 'all';

export interface JobFilters {
  q?: string;
  status?: JobStatus | 'all';
  scope?: JobScope;
}

function scopeCondition(scope: JobScope | undefined): SQL | undefined {
  if (scope === 'open') return sql`NOT ${JOB_IS_SETTLED}`;
  if (scope === 'pre-invoice') return JOB_IS_PRE_INVOICE;
  if (scope === 'settled') return JOB_IS_SETTLED;
  return undefined;
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
  const conditions: (SQL | undefined)[] = [
    notDeleted,
    searchCondition(filters.q),
    scopeCondition(filters.scope),
  ];

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

/**
 * One pipeline bucket, newest first — the Overview's two job lists.
 *
 * Takes a bucket rather than a status so the lists match the tiles directly
 * above them. The lists were previously keyed on status, which is how the
 * Overview came to show a "Completed jobs — ready to invoice" card holding two
 * jobs that had in fact both been invoiced, one of them paid in full.
 */
export async function listJobsInPipeline(
  bucket: 'active' | 'invoiced' | 'paid',
  limit = 10,
) {
  const condition =
    bucket === 'active'
      ? JOB_IS_PRE_INVOICE
      : bucket === 'invoiced'
        ? JOB_IS_AWAITING_PAYMENT
        : JOB_IS_SETTLED;

  return db
    .select()
    .from(jobs)
    .where(and(condition, notDeleted))
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
 * The most recent job for a registration.
 *
 * Reads history rather than introducing a customer table — a repeat visit is
 * just the previous job's details copied forward, and nothing has to stay in
 * sync. `lib/db/queries/vehicles.ts` extends the same idea to partial matches
 * and to the vehicle's running totals.
 *
 * Matched on the normalised registration, not the stored text. Upper-casing the
 * term alone was not enough: plates are stored as typed, so the reg entered as
 * `142-KY-9821` was invisible to a search for `142KY9821` — the same car, and
 * the lookup returned "never seen before".
 */
export async function findJobByRegistration(registration: string) {
  const term = normalizeRegistration(registration);
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
    .where(and(eq(NORMALIZED_REGISTRATION, term), notDeleted))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Jobs with a live invoice that still has money owed on it.
 *
 * Keyed on the payments, not on `jobs.status`. This list used to filter
 * `status <> 'paid'`, which meant a settled job whose status had drifted stayed
 * here forever showing EUR 0.00 owed — J-0019 did exactly that. Now the only
 * two things that remove a job are the balance reaching zero and the invoice
 * being voided, both of which are facts about the invoice rather than labels
 * on the job. `getOutstandingInvoiceTotalCents` filters on the same predicate,
 * so the page header and its rows cannot disagree.
 *
 * A job stays in this list, at a shrinking amount, through any number of
 * partial payments.
 *
 * Takes the same optional search term as `listSettledJobs`. This page is now
 * where invoiced work lives rather than a money summary the owner skims, so it
 * needs to be searchable for the same reason `/paid-jobs` is: the hint on
 * `/jobs` links here with the term already in the URL, and landing on an
 * unfiltered list would make the reader do the search a second time by eye.
 */
export async function listAwaitingPayment(q?: string) {
  return db
    .select({
      job: jobs,
      invoice: invoices,
      remainingCents: REMAINING_CENTS,
    })
    .from(jobs)
    .innerJoin(invoices, and(eq(invoices.jobId, jobs.id), isNull(invoices.voidedAt)))
    .where(and(INVOICE_HAS_BALANCE, notDeleted, searchCondition(q)))
    .orderBy(desc(jobs.updatedAt));
}

/**
 * Finished business: jobs whose live invoice has been settled in full.
 *
 * The inverse of `listAwaitingPayment` over the same join, so a job is in
 * exactly one of the two. Carries the invoice and the date of the final payment
 * because that is what the page is actually for — looking up what was billed
 * and when it was settled, months later.
 */
export async function listSettledJobs(q?: string) {
  return db
    .select({
      job: jobs,
      invoice: invoices,
      paidAt: sql<string | null>`${LAST_PAYMENT_AT}`,
    })
    .from(jobs)
    .innerJoin(invoices, and(eq(invoices.jobId, jobs.id), isNull(invoices.voidedAt)))
    .where(and(INVOICE_IS_SETTLED, notDeleted, searchCondition(q)))
    // Most recently settled first. NULLS LAST keeps a zero-total invoice with
    // no payment row behind it from floating to the top of "recently paid".
    .orderBy(sql`${LAST_PAYMENT_AT} DESC NULLS LAST`)
    .limit(500);
}

/**
 * How many settled jobs a search would have matched.
 *
 * `/jobs` no longer lists settled work, so a search there for a customer who
 * has already paid would otherwise come back empty and look like the job had
 * been lost. The page uses this to point at `/paid-jobs` instead.
 */
export async function countSettledJobs(q?: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(notDeleted, JOB_IS_SETTLED, searchCondition(q)));

  return Number(rows[0]?.n ?? 0);
}

/**
 * The same trick for invoiced work, which `/jobs` has also stopped listing.
 *
 * Without this the split would have re-opened the exact hole `countSettledJobs`
 * was written to close, one bucket over: a search on `/jobs` for a customer
 * invoiced yesterday returns nothing, and "nothing" reads as "the job is gone"
 * rather than "it moved on a step". Two buckets are hidden from this page now,
 * so both need a way back.
 */
export async function countAwaitingPaymentJobs(q?: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(notDeleted, JOB_IS_AWAITING_PAYMENT, searchCondition(q)));

  return Number(rows[0]?.n ?? 0);
}

/**
 * The three Overview tiles, as one query.
 *
 * Counts the pipeline — not billed, billed and owed, settled — rather than
 * `jobs.status`, so each tile agrees with the list it links to. The old
 * version grouped by status and reported "Paid: 0" while EUR 450 sat collected
 * against J-0019, because that job's status column said `completed`.
 *
 * The three buckets partition every live job exactly once, so they sum to the
 * total. `active` is deliberately "not yet invoiced" and so covers both the
 * `active` and `completed` statuses — work in the workshop, whether or not it
 * is finished.
 */
export async function countJobPipeline() {
  const rows = await db
    .select({
      active: sql<number>`COUNT(*) FILTER (WHERE ${JOB_IS_PRE_INVOICE})::int`,
      invoiced: sql<number>`COUNT(*) FILTER (WHERE ${JOB_IS_AWAITING_PAYMENT})::int`,
      paid: sql<number>`COUNT(*) FILTER (WHERE ${JOB_IS_SETTLED})::int`,
    })
    .from(jobs)
    .where(notDeleted);

  const row = rows[0];
  return {
    active: Number(row?.active ?? 0),
    invoiced: Number(row?.invoiced ?? 0),
    paid: Number(row?.paid ?? 0),
  };
}
