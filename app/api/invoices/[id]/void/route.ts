import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { invoices, jobs } from '@/lib/db/schema';
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

  if (invoice.voidedAt) {
    return Response.json(
      { error: `Invoice ${invoice.invoiceNumber} is already void.` },
      { status: 400 },
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ voidedAt: new Date(), voidReason: parsed.data.reason ?? null })
      .where(eq(invoices.id, id));

    await tx
      .update(jobs)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jobs.id, invoice.jobId));
  });

  // The PDF is left in storage on purpose: a voided invoice the customer already
  // holds should still be retrievable, and it costs a few kilobytes.

  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${invoice.jobId}`);
  revalidatePath('/awaiting-payments');
  revalidatePath('/invoicer');

  return Response.json({ ok: true, invoiceNumber: invoice.invoiceNumber });
}
