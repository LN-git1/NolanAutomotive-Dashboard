import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { invoices, jobs } from '@/lib/db/schema';
import { getPaidCentsForInvoice } from '@/lib/db/queries/payments';
import { formatEur } from '@/lib/money';
import { invoiceVoidSchema } from '@/lib/validation/invoice';

export const runtime = 'nodejs';

/**
 * VOID. Never deletes.
 *
 * Deleting would put a permanent gap in the invoice sequence, which is exactly
 * what the counter design exists to prevent — Revenue expects a continuous run.
 * So the row stays, its number stays consumed, and `voidedAt` takes it out of
 * every money figure instead.
 *
 * The job drops back to `completed`, which frees it to be invoiced again under a
 * fresh number. That is what makes voiding useful rather than merely tidy: a job
 * invoiced by mistake can be corrected without inventing a credit note the
 * template has no room for.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;

  const parsed = invoiceVoidSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);

  if (!invoice) {
    return Response.json({ error: 'Invoice not found' }, { status: 404 });
  }

  // Everything that decides "may this be voided" is re-read INSIDE the
  // transaction, after locking the job row first — the same lock order
  // `applyPayment` uses, so a payment and a void serialise instead of the void
  // passing its paid check and a payment then committing before the update.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM jobs WHERE id = ${invoice.jobId} FOR UPDATE`);

    const [current] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!current) return { error: 'Invoice not found', status: 404 } as const;

    if (current.voidedAt) {
      return { error: `Invoice ${current.invoiceNumber} is already void.`, status: 400 } as const;
    }

    // A voided invoice drops out of every money query (voidedAt IS NULL is
    // required everywhere), which would take any real payment already recorded
    // against it with it — cash the business actually collected would vanish
    // from every report. No refund/credit-note flow exists yet, so voiding an
    // invoice with payments is refused outright rather than silently losing
    // that money.
    const paidCents = await getPaidCentsForInvoice(id, tx);
    if (paidCents > 0) {
      return {
        error: `${current.invoiceNumber} has ${formatEur(paidCents)} recorded against it and can't be voided.`,
        status: 400,
      } as const;
    }

    await tx
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: parsed.data.reason ?? null })
      .where(eq(invoices.id, id));

    await tx
      .update(jobs)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jobs.id, invoice.jobId));

    return null;
  });

  if (outcome) return Response.json({ error: outcome.error }, { status: outcome.status });

  // The PDF is left in storage on purpose: a voided invoice the customer already
  // holds should still be retrievable, and it costs a few kilobytes.

  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${invoice.jobId}`);
  revalidatePath('/awaiting-payments');
  // Voiding takes a settled job back out of Paid jobs — the invoice behind it
  // is gone, so it is uninvoiced work again.
  revalidatePath('/paid-jobs');
  revalidatePath('/invoicer');
  revalidatePath('/earnings');

  return Response.json({ ok: true, invoiceNumber: invoice.invoiceNumber });
}
