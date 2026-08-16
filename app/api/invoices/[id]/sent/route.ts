import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { invoices } from '@/lib/db/schema';
import { invoiceRegenerateSchema } from '@/lib/validation/invoice';

export const runtime = 'nodejs';

/**
 * Record that an invoice was actually sent, and how.
 *
 * Kept apart from issuing on purpose. The owner taps Email or WhatsApp and the
 * platform opens immediately — no PDF work, no upload, nothing to wait for.
 * This call just stamps `sentVia` / `sentAt` and is fired without blocking the
 * redirect, so a slow network delays the record rather than the send.
 *
 * It is idempotent: sending the same invoice twice simply moves `sentAt`
 * forward, which is the truth — the customer was sent it twice.
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

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);

  if (!invoice) {
    return Response.json({ error: 'Invoice not found' }, { status: 404 });
  }

  await db
    .update(invoices)
    .set({ sentVia: parsed.data.sentVia, sentAt: new Date() })
    .where(eq(invoices.id, id));

  revalidatePath('/');
  revalidatePath(`/jobs/${invoice.jobId}`);

  return Response.json({ ok: true });
}
