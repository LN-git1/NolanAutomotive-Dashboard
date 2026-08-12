import { eq } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { invoices } from '@/lib/db/schema';
import { DOWNLOAD_TTL_SECONDS, createSignedDownloadUrl } from '@/lib/storage/signedUrl';
import { INVOICES_BUCKET } from '@/lib/storage/supabaseAdmin';

export const runtime = 'nodejs';

/**
 * Re-open a finalised invoice PDF. Redirects to a short-lived signed URL rather
 * than streaming the bytes back through this function — the file is already in
 * private storage and there is no reason to pay for the transfer twice.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;

  const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  const invoice = rows[0];

  if (!invoice) {
    return Response.json({ error: 'Invoice not found' }, { status: 404 });
  }

  try {
    const url = await createSignedDownloadUrl(
      INVOICES_BUCKET,
      invoice.pdfStoragePath,
      DOWNLOAD_TTL_SECONDS,
    );

    return Response.redirect(url, 307);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not open the invoice PDF' },
      { status: 500 },
    );
  }
}
