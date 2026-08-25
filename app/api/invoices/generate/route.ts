import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireApiSession } from '@/lib/auth/require-session';
import { allocateNumber, formatInvoiceNumber } from '@/lib/counters';
import { db } from '@/lib/db';
import { invoices, jobs } from '@/lib/db/schema';
import { getPaidCentsForInvoice } from '@/lib/db/queries/payments';
import {
  InvoiceBuildError,
  buildInvoice,
  buildInvoiceFileName,
  invoiceSnapshot,
  pdfResponse,
} from '@/lib/invoices/build';
import { numericToEur } from '@/lib/format';
import { formatEur, toCents } from '@/lib/money';
import { stampInvoice } from '@/lib/pdf/stamp';
import { buildInvoicePath, uploadBytes } from '@/lib/storage/signedUrl';
import { INVOICES_BUCKET } from '@/lib/storage/r2';
import { invoiceDraftSchema } from '@/lib/validation/invoice';
import { todayIsoDate } from '@/lib/format';

export const runtime = 'nodejs';

/**
 * Hobby's ceiling is 300s. Stamping takes about a second, so this lowers a limit
 * rather than raising one: a hung database, R2 fetch or upload is cut off after
 * a minute instead of holding a function slot for five.
 */
export const maxDuration = 60;

/**
 * ISSUE an invoice. This is the only place an invoice number is consumed.
 *
 * Generating *is* creating. It used to be a free preview, with a second
 * ten-second round trip to commit when the owner picked a channel — so sending
 * an invoice meant waiting twice and tapping twice, and the app felt slow for
 * no benefit the owner could see.
 *
 * The old split existed to keep the number sequence gap-free by not burning a
 * number on an abandoned preview. That still holds here, and more simply: every
 * number issued now has a real invoice row behind it, so the sequence has no
 * gaps by construction. An invoice generated and then thought better of is
 * voided, not deleted — which is the mechanism that already exists for exactly
 * that case.
 *
 * Delivery is recorded separately by `/api/invoices/[id]/sent`, because issuing
 * and sending are different events and the owner may do neither, one, or both.
 *
 * Called again for a job that already has a live invoice, this REGENERATES that
 * invoice: same number, same issue date, same storage path, no new number. That
 * is what makes "edit the job and send it again" work.
 */
/**
 * Issuing or regenerating an invoice changes the jobs list, the Overview and
 * what the business is owed, none of which this route used to tell Next about —
 * the Invoicer's own `router.refresh()` only refreshes the route it is mounted
 * on.
 *
 * Deliberately NOT `/earnings`: Earnings sums `payments`, a new invoice has
 * none, and regenerating is refused outright once any payment exists, so
 * neither path here can move those figures.
 */
function revalidateInvoicePaths(jobId: string) {
  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/awaiting-payments');
  revalidatePath('/paid-jobs');
  revalidatePath('/invoicer');
}

export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = invoiceDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid invoice details' },
      { status: 400 },
    );
  }

  const { jobId } = parsed.data;

  try {
    // Is there already a live invoice for this job? A voided one does not count
    // — voiding exists precisely so a job can be invoiced again.
    const [existing] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.jobId, jobId), isNull(invoices.voidedAt)))
      .limit(1);

    /* ------------------------------------------------ regenerate an existing */
    if (existing) {
      // Regenerating overwrites this invoice's grandTotal in place with no
      // recomputation against what has actually been paid — a job fully paid
      // at €500, re-sent after the owner adds a missed part, would silently
      // become €650 owed on €500 collected, with the €150 shortfall invisible
      // everywhere (the job would still read `paid`, excluding it from
      // Awaiting Payments too). No reconciliation flow exists yet, so
      // regenerating an invoice with any recorded payment is refused outright.
      const paidCents = await getPaidCentsForInvoice(existing.id);
      if (paidCents > 0) {
        throw new InvoiceBuildError(
          `${existing.invoiceNumber} has ${formatEur(paidCents)} recorded against it and can't be regenerated.`,
        );
      }

      const built = await buildInvoice(jobId, {
        invoiceNumber: existing.invoiceNumber,
        // The invoice was issued when it was issued; correcting it does not move
        // it into a later tax period.
        issueDate: new Date(`${existing.issueDate}T00:00:00`),
      });

      /**
       * Never replace a real invoice with an empty one. Regenerating overwrites
       * the stored PDF in place, so a job that has been emptied would destroy
       * the only copy of a document the customer already holds.
       */
      if (built.totals.grandTotalCents === 0 && toCents(existing.grandTotal) !== 0) {
        throw new InvoiceBuildError(
          `Job ${built.job.jobNumber} has no work lines or parts on it, so regenerating would ` +
            `replace invoice ${existing.invoiceNumber} ` +
            `(${numericToEur(existing.grandTotal)}) with a blank one. Add the work to the job ` +
            `first, or void this invoice if it was issued in error.`,
        );
      }

      const bytes = await stampInvoice(built.stampInput);

      let storageFailed = false;
      try {
        await uploadBytes(INVOICES_BUCKET, existing.pdfStoragePath, bytes, 'application/pdf');
      } catch {
        storageFailed = true;
      }

      await db
        .update(invoices)
        .set(invoiceSnapshot(built))
        .where(eq(invoices.id, existing.id));

      revalidateInvoicePaths(jobId);

      return pdfResponse(
        bytes,
        buildInvoiceFileName(
          existing.invoiceNumber,
          built.job.customerName,
          built.job.vehicleRegistration,
        ),
        {
          'X-Invoice-Number': existing.invoiceNumber,
          'X-Invoice-Id': existing.id,
          'X-Invoice-Reissued': '1',
          ...(storageFailed ? { 'X-Storage-Failed': '1' } : {}),
        },
      );
    }

    /* ---------------------------------------------------- issue a new invoice */
    const issueDate = new Date();

    // Price it BEFORE opening the transaction, so a bad job never takes a lock
    // on the counter row.
    const preflight = await buildInvoice(jobId, { invoiceNumber: 'PENDING', issueDate });

    /**
     * Refuse to issue a EUR 0.00 invoice.
     *
     * `buildInvoice` only checks that the job exists and that its line counts
     * fit the template — nothing stops a job with no labour lines, no hourly
     * rate and no parts from pricing at zero. Regenerate already refuses to
     * replace a real invoice with a blank one; a first issue had no equivalent
     * guard, so a job invoiced before any work was entered would allocate a
     * real number for a document worth nothing.
     *
     * That matters beyond a wasted number: `invoice-state.ts`'s `INVOICE_IS_SETTLED`
     * now also refuses a zero-total invoice on principle (nobody paid a cent for
     * it), so an issued one would sit forever in neither Awaiting Payments nor
     * Paid jobs — visible only back on Jobs, invoiced, owing nothing, which
     * reads as broken rather than as the mistake it actually is. Refusing it
     * here means the owner fills in the job first, same as regenerate demands.
     */
    if (preflight.totals.grandTotalCents === 0) {
      throw new InvoiceBuildError(
        `Job ${preflight.job.jobNumber} has no work lines or parts on it, so there is nothing to ` +
          `invoice yet. Add the work to the job first.`,
      );
    }

    const result = await db.transaction(async (tx) => {
      // Lock the job first. Without this, two generate calls for the same job (a
      // double tap, a retry, a second tab) could both pass the check above and
      // each allocate a number, leaving one job with two live invoices.
      await tx.execute(sql`SELECT id FROM jobs WHERE id = ${jobId} FOR UPDATE`);

      const [raced] = await tx
        .select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(and(eq(invoices.jobId, jobId), isNull(invoices.voidedAt)))
        .limit(1);

      if (raced) {
        throw new InvoiceBuildError(
          `This job was invoiced as ${raced.invoiceNumber} a moment ago. Reload and try again.`,
        );
      }

      const allocated = await allocateNumber(tx, 'invoice');
      const invoiceNumber = formatInvoiceNumber(allocated, issueDate.getFullYear());
      const storagePath = buildInvoicePath(invoiceNumber);

      const [created] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          jobId,
          issueDate: todayIsoDate(),
          pdfStoragePath: storagePath,
          // Issued, not yet sent. `/sent` fills these in on delivery.
          sentVia: null,
          sentAt: null,
          ...invoiceSnapshot(preflight),
        })
        .returning({ id: invoices.id });

      if (!created) throw new Error('Invoice insert returned no row');

      await tx
        .update(jobs)
        .set({ status: 'invoiced', updatedAt: new Date() })
        .where(eq(jobs.id, jobId));

      return { id: created.id, invoiceNumber, storagePath };
    });

    // Re-stamp with the number actually allocated, so the stored document always
    // matches the stored row.
    const finalBuild = await buildInvoice(jobId, {
      invoiceNumber: result.invoiceNumber,
      issueDate,
    });
    const bytes = await stampInvoice(finalBuild.stampInput);

    /**
     * The invoice is committed by this point, so a storage failure must not be
     * reported as a plain 500 — that would hide the PDF behind an opaque error
     * on a number that has definitely been consumed. Return the bytes and flag
     * it so the owner can send now and the file can be re-uploaded later.
     */
    let storageFailed = false;
    try {
      await uploadBytes(INVOICES_BUCKET, result.storagePath, bytes, 'application/pdf');
    } catch {
      storageFailed = true;
    }

    revalidateInvoicePaths(jobId);

    return pdfResponse(
      bytes,
      buildInvoiceFileName(
        result.invoiceNumber,
        finalBuild.job.customerName,
        finalBuild.job.vehicleRegistration,
      ),
      {
        'X-Invoice-Number': result.invoiceNumber,
        'X-Invoice-Id': result.id,
        ...(storageFailed ? { 'X-Storage-Failed': '1' } : {}),
      },
    );
  } catch (error) {
    const message =
      error instanceof InvoiceBuildError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not generate the invoice.';

    return Response.json(
      { error: message },
      { status: error instanceof InvoiceBuildError ? 400 : 500 },
    );
  }
}
