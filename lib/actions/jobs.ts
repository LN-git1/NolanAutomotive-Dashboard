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
import { jobInputSchema, jobStatusSchema } from '@/lib/validation/job';

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

export async function updateJob(jobId: string, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = jobInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid job details' };
  }

  await db
    .update(jobs)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));

  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/');
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

export async function changeJobStatus(jobId: string, status: string): Promise<ActionResult> {
  await requireSession();

  const parsed = jobStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: 'Invalid status' };

  await db
    .update(jobs)
    .set({ status: parsed.data, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));

  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/awaiting-payments');
  revalidatePath('/');
  return { ok: true, jobId };
}

/** Marks a job paid. Used by Awaiting Payments. */
export async function markJobPaid(jobId: string): Promise<ActionResult> {
  return changeJobStatus(jobId, 'paid');
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
