import { and, eq, isNull, sql } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { allocateNumber, formatInvoiceNumber } from '@/lib/counters';
import { db } from '@/lib/db';
import { invoices, jobs } from '@/lib/db/schema';
import {
  InvoiceBuildError,
  buildInvoice,
  buildInvoiceFileName,
  invoiceSnapshot,
  pdfResponse,
} from '@/lib/invoices/build';
import { stampInvoice } from '@/lib/pdf/stamp';
import { buildInvoicePath, uploadBytes } from '@/lib/storage/signedUrl';
import { INVOICES_BUCKET } from '@/lib/storage/r2';
import { invoiceFinalizeSchema } from '@/lib/validation/invoice';
import { todayIsoDate } from '@/lib/format';

export const runtime = 'nodejs';

/**
 * Hobby's ceiling is 300s (default and maximum, with Fluid Compute). Stamping
 * takes about a second, so this is not raising a limit — it lowers one, so a
 * hung database, R2 fetch or storage call is cut off after a minute instead of
 * holding a function slot for five.
 */
export const maxDuration = 60;


/**
 * COMMIT. This is the only place an invoice number is consumed.
 *
 * Ordering matters and is deliberate:
 *
 *  1. Allocate the number and insert the invoice row and flip the job status,
 *     all inside ONE transaction. If anything fails, the number is released
 *     with the rollback and no gap appears in the sequence.
 *  2. Re-stamp the PDF with the number that was actually allocated, rather than
 *     trusting whatever provisional number the preview displayed. The stored
 *     document therefore always matches the stored row.
 *  3. Upload, then return the authoritative bytes so the client shares exactly
 *     the file that was persisted.
 *
 * Storage upload happens after the commit: a successfully recorded invoice with
 * a retryable upload is recoverable, whereas an uploaded file with no row is an
 * orphan nobody knows about.
 *
 * Note this route creates the invoice, so it has no `[id]` segment — there is
 * nothing to address until it has run.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = invoiceFinalizeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid invoice details' },
      { status: 400 },
    );
  }

  const draft = parsed.data;
  const issueDate = new Date();

  try {
    // Validate and price the invoice BEFORE opening the transaction, so a bad
    // job never takes a lock on the counter row.
    const preflight = await buildInvoice(draft.jobId, {
      invoiceNumber: 'PENDING',
      issueDate,
    });

    const result = await db.transaction(async (tx) => {
      // Lock the job row first. Without this, two finalize calls for the same
      // job (a double submit, a retry, a second tab) could both pass the
      // duplicate check below and each allocate a number, leaving one job with
      // two live invoices. Locking serialises them so the second sees the first.
      await tx.execute(sql`SELECT id FROM jobs WHERE id = ${draft.jobId} FOR UPDATE`);

      // Voided invoices do not block a reissue — that is the entire point of
      // voiding. Only a live invoice counts as "already invoiced".
      const [existing] = await tx
        .select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(and(eq(invoices.jobId, draft.jobId), isNull(invoices.voidedAt)))
        .limit(1);

      if (existing) {
        throw new InvoiceBuildError(
          `This job has already been invoiced as ${existing.invoiceNumber}. ` +
            `Open the job to edit and re-send that invoice, or void it to issue a new one.`,
        );
      }

      const allocated = await allocateNumber(tx, 'invoice');
      const invoiceNumber = formatInvoiceNumber(allocated, issueDate.getFullYear());
      const storagePath = buildInvoicePath(invoiceNumber);

      const [created] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          jobId: draft.jobId,
          issueDate: todayIsoDate(),
          pdfStoragePath: storagePath,
          sentVia: draft.sentVia,
          ...invoiceSnapshot(preflight),
        })
        .returning({ id: invoices.id });

      if (!created) throw new Error('Invoice insert returned no row');

      await tx
        .update(jobs)
        .set({ status: 'invoiced', updatedAt: new Date() })
        .where(eq(jobs.id, draft.jobId));

      return { id: created.id, invoiceNumber, storagePath };
    });

    // Re-stamp with the number that was actually allocated.
    const finalBuild = await buildInvoice(draft.jobId, {
      invoiceNumber: result.invoiceNumber,
      issueDate,
    });
    const bytes = await stampInvoice(finalBuild.stampInput);

    /**
     * The invoice is already committed at this point, so a storage failure must
     * not be reported as a plain 500: that would hide the PDF the owner just
     * created behind an opaque error, on an invoice number that has definitely
     * been consumed. Return the bytes regardless and flag the failure so the
     * owner can send the invoice now and the file can be re-uploaded later.
     */
    let storageFailed = false;
    try {
      await uploadBytes(INVOICES_BUCKET, result.storagePath, bytes, 'application/pdf');
    } catch {
      storageFailed = true;
    }

    const fileName = buildInvoiceFileName(
      result.invoiceNumber,
      finalBuild.job.customerName,
      finalBuild.job.vehicleRegistration,
    );

    return pdfResponse(bytes, fileName, {
      'X-Invoice-Number': result.invoiceNumber,
      'X-Invoice-Id': result.id,
      ...(storageFailed ? { 'X-Storage-Failed': '1' } : {}),
    });
  } catch (error) {
    const message =
      error instanceof InvoiceBuildError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not finalise the invoice.';

    return Response.json(
      { error: message },
      { status: error instanceof InvoiceBuildError ? 400 : 500 },
    );
  }
}
