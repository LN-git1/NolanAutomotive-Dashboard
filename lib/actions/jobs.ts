'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { guardedWrite } from '@/lib/actions/safe';
import { requireSession } from '@/lib/auth/require-session';
import { allocateNumber, formatJobNumber } from '@/lib/counters';
import { db } from '@/lib/db';
import { findJobByRegistration } from '@/lib/db/queries/jobs';
import {
  getVehicleHistory,
  searchVehicles,
  type VehicleHistoryEntry,
  type VehicleMatch,
} from '@/lib/db/queries/vehicles';
import { jobAttachments, jobs } from '@/lib/db/schema';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { removeObject } from '@/lib/storage/signedUrl';
import { uuidString } from '@/lib/validation/common';
import { jobContentSchema, jobStatusChangeSchema } from '@/lib/validation/job';

export interface ActionResult {
  ok: boolean;
  error?: string;
  jobId?: string;
}

/** Thrown inside the create transaction to roll it back when the job already exists. */
class DuplicateSubmission extends Error {
  constructor(readonly jobId: string) {
    super('Duplicate job submission');
  }
}

/**
 * Create a job, allocating its job number inside the same transaction as the
 * insert. If the insert fails the number is released with it, so the sequence
 * never develops a gap.
 */
export async function createJob(formData: FormData): Promise<ActionResult> {
  await requireSession();

  // `jobContentSchema`, not `jobInputSchema`: the create form never renders a
  // status control, so any `status` key in the FormData reaches here only by
  // bypassing the browser UI. Omitting it means the jobs table's own
  // `default('active')` decides, which is what a new job should be regardless.
  const parsed = jobContentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid job details' };
  }

  const input = parsed.data;
  // Minted by the form per "page load". Absent or malformed just means no dedupe.
  const keyParsed = uuidString.safeParse(formData.get('submissionKey'));
  const submissionKey = keyParsed.success ? keyParsed.data : null;

  try {
    const jobId = await db
      .transaction(async (tx) => {
        // Allocating first matters: it takes the counter row's lock, so two
        // simultaneous submits of the same form queue here and the second one
        // sees the first's committed job below.
        const nextNumber = await allocateNumber(tx, 'job');

        if (submissionKey) {
          const [existing] = await tx
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.submissionKey, submissionKey))
            .limit(1);
          // A double tap or retried request. Roll back (releasing the job number
          // so the sequence has no gap) and hand back the job already created.
          if (existing) throw new DuplicateSubmission(existing.id);
        }

        const [created] = await tx
          .insert(jobs)
          .values({ ...input, submissionKey, jobNumber: formatJobNumber(nextNumber) })
          .returning({ id: jobs.id });

        if (!created) throw new Error('Job insert returned no row');
        return created.id;
      })
      .catch((error: unknown) => {
        if (error instanceof DuplicateSubmission) return error.jobId;
        throw error;
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
 * `jobContentSchema` omits `status` on purpose; see the comment on it. Parsing
 * with the full `jobInputSchema` here is what let a routine save revert a
 * settled job, so the field must stay out of the parse rather than be stripped
 * afterwards.
 */
export async function updateJob(jobId: string, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = jobContentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid job details' };
  }

  return guardedWrite('updateJob', async () => {
    const updated = await db
      .update(jobs)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))
      .returning({ id: jobs.id });
    if (updated.length === 0) return { ok: false, error: 'This job no longer exists.' };

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath('/paid-jobs');
    revalidatePath('/awaiting-payments');
    revalidatePath('/');
    // dueDate is the Monthly breakdown's grouping key — editing it moves money
    // between months.
    revalidatePath('/earnings');
    return { ok: true, jobId };
  });
}

/**
 * Look up the last job for an EXACT registration.
 *
 * The job form no longer calls this — it uses `searchVehicleRegistrations`
 * below, which matches partial registrations and returns the vehicle's history
 * with it. Kept because it is still the right shape for a caller that already
 * holds a full registration and wants one answer, and because the in-flight
 * job-import branch imports it.
 */
export async function lookupJobByRegistration(registration: string) {
  await requireSession();
  return findJobByRegistration(registration);
}

/**
 * Registration typeahead for the job form.
 *
 * Lee's actual question when a car comes in is "have we had this one before?",
 * and he asks it with a fragment — `98D` means "one of the 1998 Dublin cars",
 * not a registration. An exact-match lookup could only ever answer that with
 * silence, so this returns every vehicle the fragment could mean and lets him
 * pick. Customer names match too, which is the same question from the other
 * end: one customer with three cars gets three rows.
 *
 * Returns the whole `VehicleMatch` — the customer and vehicle details to
 * prefill, plus the history figures the dropdown shows. Those come from one
 * grouped query, so offering the choice costs no more round trips than the
 * single-answer lookup it replaces.
 */
export async function searchVehicleRegistrations(term: string): Promise<VehicleMatch[]> {
  await requireSession();
  return searchVehicles(term);
}

/**
 * Every job ever done on one vehicle — the breakdown behind the summary line.
 *
 * Kept out of `searchVehicleRegistrations` on purpose: that returns up to eight
 * vehicles and this returns up to a hundred jobs each, so folding it in would
 * ship several hundred rows to the browser on every keystroke to render three
 * numbers. It is fetched once, for the one vehicle actually chosen.
 */
export async function loadVehicleHistory(registration: string): Promise<VehicleHistoryEntry[]> {
  await requireSession();
  return getVehicleHistory(registration);
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

  return guardedWrite('changeJobStatus', async () => {
    // Under the same job-row lock `applyPayment` takes, so a status change and a
    // payment landing together serialise instead of the last writer winning.
    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM jobs WHERE id = ${parsed.data.jobId} FOR UPDATE`);
      return tx
        .update(jobs)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(and(eq(jobs.id, parsed.data.jobId), isNull(jobs.deletedAt)))
        .returning({ id: jobs.id });
    });
    if (updated.length === 0) return { ok: false, error: 'This job no longer exists.' };

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath('/paid-jobs');
    revalidatePath('/awaiting-payments');
    revalidatePath('/earnings');
    revalidatePath('/');
    return { ok: true, jobId };
  });
}

/**
 * Soft delete. The row is retained because it may be referenced by an issued
 * invoice, which must remain reconstructable for tax purposes.
 */
export async function softDeleteJob(jobId: string): Promise<ActionResult> {
  await requireSession();

  return guardedWrite('softDeleteJob', async () => {
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
  });
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

  return guardedWrite('recordAttachment', async () => {
    await db.insert(jobAttachments).values({
      jobId: input.jobId,
      storagePath: input.storagePath,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
    });

    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  });
}

/** Delete an attachment from both Storage and the database. */
export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  await requireSession();

  return guardedWrite('deleteAttachment', async () => {
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
  });
}
