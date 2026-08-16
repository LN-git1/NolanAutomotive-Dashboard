import { requireApiSession } from '@/lib/auth/require-session';
import { formatInvoiceNumber, peekNextNumber } from '@/lib/counters';
import { db } from '@/lib/db';
import { InvoiceBuildError, buildInvoice, pdfResponse } from '@/lib/invoices/build';
import { stampInvoice } from '@/lib/pdf/stamp';
import { invoiceDraftSchema } from '@/lib/validation/invoice';

export const runtime = 'nodejs';

/**
 * Hobby's ceiling is 300s (default and maximum, with Fluid Compute). Stamping
 * takes about a second, so this is not raising a limit — it lowers one, so a
 * hung database, R2 fetch or storage call is cut off after a minute instead of
 * holding a function slot for five.
 */
export const maxDuration = 60;


/**
 * PREVIEW ONLY. Writes nothing.
 *
 * The invoice number shown here is provisional: the counter is read but not
 * consumed, so the owner can regenerate a preview as many times as they like
 * while adjusting parts and labour without burning numbers. A gap-free invoice
 * sequence is a Revenue expectation, and abandoned previews are the obvious way
 * to accidentally create gaps.
 *
 * The authoritative number is allocated in /api/invoices/finalize.
 */
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

  try {
    const issueDate = new Date();
    const provisional = await peekNextNumber(db, 'invoice');
    const invoiceNumber = formatInvoiceNumber(provisional, issueDate.getFullYear());

    const built = await buildInvoice(parsed.data.jobId, { invoiceNumber, issueDate });
    const bytes = await stampInvoice(built.stampInput);

    return pdfResponse(bytes, `${invoiceNumber}-preview.pdf`, {
      'X-Provisional-Invoice-Number': invoiceNumber,
      // Lets the Invoicer warn before an already-paid job's invoice is replaced.
      ...(built.alreadyPaid ? { 'X-Job-Already-Paid': '1' } : {}),
    });
  } catch (error) {
    const message =
      error instanceof InvoiceBuildError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not generate the invoice.';

    return Response.json({ error: message }, { status: error instanceof InvoiceBuildError ? 400 : 500 });
  }
}
