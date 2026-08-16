import { eq } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { invoices } from '@/lib/db/schema';
import {
  InvoiceBuildError,
  buildInvoice,
  buildInvoiceFileName,
  invoiceSnapshot,
  pdfResponse,
} from '@/lib/invoices/build';
import { stampInvoice } from '@/lib/pdf/stamp';
import { uploadBytes } from '@/lib/storage/signedUrl';
import { INVOICES_BUCKET } from '@/lib/storage/r2';
import { invoiceRegenerateSchema } from '@/lib/validation/invoice';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * RE-SEND. Rebuilds an existing invoice from its job's current content.
 *
 * Three things deliberately do NOT change:
 *
 *  - the invoice number, so the customer keeps one reference for one repair and
 *    the sequence never grows a gap;
 *  - the issue date, because the invoice was issued when it was issued —
 *    correcting a typo does not move it into a later tax period;
 *  - the storage path, so the stored PDF is replaced rather than accumulating
 *    orphans, and every existing link keeps working.
 *
 * No counter is touched here at all, which is what makes this safe to run as
 * many times as the owner likes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;

  const parsed = invoiceRegenerateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);

    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.voidedAt) {
      throw new InvoiceBuildError(
        `Invoice ${invoice.invoiceNumber} has been voided and cannot be re-sent. ` +
          `Generate a new invoice for the job instead.`,
      );
    }

    const built = await buildInvoice(invoice.jobId, {
      invoiceNumber: invoice.invoiceNumber,
      // Keep the original issue date rather than stamping today's.
      issueDate: new Date(`${invoice.issueDate}T00:00:00`),
    });

    const bytes = await stampInvoice(built.stampInput);

    // Overwrite the stored copy first: if this fails the row still describes the
    // previously stored document, which is at least consistent. Flagged rather
    // than thrown so the owner can still send the bytes they have in hand.
    let storageFailed = false;
    try {
      await uploadBytes(INVOICES_BUCKET, invoice.pdfStoragePath, bytes, 'application/pdf');
    } catch {
      storageFailed = true;
    }

    await db
      .update(invoices)
      .set({
        ...invoiceSnapshot(built),
        sentVia: parsed.data.sentVia,
        sentAt: new Date(),
      })
      .where(eq(invoices.id, id));

    const fileName = buildInvoiceFileName(
      invoice.invoiceNumber,
      built.job.customerName,
      built.job.vehicleRegistration,
    );

    return pdfResponse(bytes, fileName, {
      'X-Invoice-Number': invoice.invoiceNumber,
      'X-Invoice-Id': invoice.id,
      ...(storageFailed ? { 'X-Storage-Failed': '1' } : {}),
    });
  } catch (error) {
    const message =
      error instanceof InvoiceBuildError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not regenerate the invoice.';

    return Response.json(
      { error: message },
      { status: error instanceof InvoiceBuildError ? 400 : 500 },
    );
  }
}
