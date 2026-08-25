'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { allocateNumber, formatJobNumber } from '@/lib/counters';
import { db } from '@/lib/db';
import { findJobByRegistration } from '@/lib/db/queries/jobs';
import { jobAttachments, jobs } from '@/lib/db/schema';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { removeObject } from '@/lib/storage/signedUrl';
import { jobInputSchema, jobStatusChangeSchema, jobUpdateSchema } from '@/lib/validation/job';

export interface ActionResult {
  ok: boolean;
  error?: string;
  jobId?: string;
}

/**
 * Create a job, allocating its job number inside the same transaction as the
 * insert. If the insert fails the number is released with it, so the sequence
 * never develops a gap.
 */
export async function createJob(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = jobInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid job details' };
  }

  const input = parsed.data;

  try {
    const jobId = await db.transaction(async (tx) => {
      const nextNumber = await allocateNumber(tx, 'job');

      const [created] = await tx
        .insert(jobs)
        .values({ ...input, jobNumber: formatJobNumber(nextNumber) })
        .returning({ id: jobs.id });

      if (!created) throw new Error('Job insert returned no row');
      return created.id;
    });

    revalidatePath('/jobs');
    revalidatePath('/');
    return { ok: true, jobId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not create job' };
  }
}

/**
 * Save an edit to a job — everything except its status.
 *
 * `jobUpdateSchema` omits `status` on purpose; see the comment on it. Parsing
 * with the full `jobInputSchema` here is what let a routine save revert a
 * settled job, so the field must stay out of the parse rather than be stripped
 * afterwards.
 */
export async function updateJob(jobId: string, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = jobUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid job details' };
  }

  await db
    .update(jobs)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));

  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/paid-jobs');
  revalidatePath('/awaiting-payments');
  revalidatePath('/');
  // dueDate is the Monthly breakdown's grouping key — editing it moves money
  // between months.
  revalidatePath('/earnings');
  return { ok: true, jobId };
}

/**
 * Look up the last job for a registration so the create form can offer to fill
 * in a returning customer. Returns only the fields the form prefills — there is
 * no reason to ship a whole job row to the browser for this.
 */
export async function lookupJobByRegistration(registration: string) {
  await requireSession();
  return findJobByRegistration(registration);
}

/**
 * Move a job to any status EXCEPT `paid`.
 *
 * `paid` is refused here on purpose. Earnings sums the `payments` table, so a
 * status flipped straight to `paid` with no payment behind it would contribute
 * nothing while claiming to be settled — the same money-disappears bug that
 * gating Earnings on `status` caused in the first place. The job page
 * intercepts the status dropdown and forces the real payment flow instead
 * (`MarkPaidModal`), which routes through `recordPayment`, so the status flips
 * as a consequence of the money landing rather than instead of it.
 *
 * The guard lives here and not only in the UI because this is the layer that
 * has to hold: a stale client, or a future caller, must not be able to bypass it.
 */
export async function changeJobStatus(jobId: string, status: string): Promise<ActionResult> {
  await requireSession();

  const parsed = jobStatusChangeSchema.safeParse({ jobId, status });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid status' };

  if (parsed.data.status === 'paid') {
    return {
      ok: false,
      error: 'Record a payment to mark this job paid, so the money is counted in Earnings.',
    };
  }

  await db
    .update(jobs)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(jobs.id, parsed.data.jobId), isNull(jobs.deletedAt)));

  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/paid-jobs');
  revalidatePath('/awaiting-payments');
  revalidatePath('/earnings');
  revalidatePath('/');
  return { ok: true, jobId };
}

/**
 * Soft delete. The row is retained because it may be referenced by an issued
 * invoice, which must remain reconstructable for tax purposes.
 */
export async function softDeleteJob(jobId: string): Promise<ActionResult> {
  await requireSession();

  await db
    .update(jobs)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));

  revalidatePath('/jobs');
  revalidatePath('/');
  // A deleted job's payments drop out of Earnings, and its invoice out of
  // Awaiting Payments or Paid jobs, whichever it was sitting in.
  revalidatePath('/earnings');
  revalidatePath('/awaiting-payments');
  revalidatePath('/paid-jobs');
  return { ok: true };
}

/** Record an attachment after the browser has uploaded it straight to Storage. */
export async function recordAttachment(input: {
  jobId: string;
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
}): Promise<ActionResult> {
  await requireSession();

  await db.insert(jobAttachments).values({
    jobId: input.jobId,
    storagePath: input.storagePath,
    fileName: input.fileName,
    mimeType: input.mimeType ?? null,
    fileSizeBytes: input.fileSizeBytes ?? null,
  });

  revalidatePath(`/jobs/${input.jobId}`);
  return { ok: true };
}

/** Delete an attachment from both Storage and the database. */
export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  await requireSession();

  const rows = await db
    .select()
    .from(jobAttachments)
    .where(eq(jobAttachments.id, attachmentId))
    .limit(1);

  const attachment = rows[0];
  if (!attachment) return { ok: false, error: 'Attachment not found' };

  try {
    await removeObject(ATTACHMENTS_BUCKET, attachment.storagePath);
  } catch {
    // Storage object may already be gone; removing the row is still correct.
  }

  await db.delete(jobAttachments).where(eq(jobAttachments.id, attachmentId));

  revalidatePath(`/jobs/${attachment.jobId}`);
  return { ok: true };
}
