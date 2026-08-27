import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { supplierLedger } from '@/lib/db/schema';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { DOWNLOAD_TTL_SECONDS, createSignedDownloadUrl } from '@/lib/storage/signedUrl';

export const runtime = 'nodejs';

/**
 * Open the receipt attached to a supplier account entry.
 *
 * Same shape as `/api/invoices/[id]/pdf` — redirect to a short-lived signed
 * URL rather than streaming the bytes through this function.
 *
 * This route did not exist before: a receipt could be uploaded via the add
 * form and its path stored on the row, but nothing could ever sign a URL for
 * it, so an uploaded receipt was permanently unreachable.
 *
 * The URL still says `supplier-bills` because the table still does — see the
 * note on `supplierLedger` in `lib/db/schema.ts`. Every receipt already in R2
 * is reachable only through the id of the row that points at it, so those ids
 * were kept exactly as they were when bills became account entries.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;

  const rows = await db.select().from(supplierLedger).where(eq(supplierLedger.id, id)).limit(1);
  const entry = rows[0];

  if (!entry) {
    return Response.json({ error: 'Entry not found' }, { status: 404 });
  }

  if (!entry.attachmentStoragePath) {
    return Response.json({ error: 'This entry has no receipt attached' }, { status: 404 });
  }

  try {
    const url = await createSignedDownloadUrl(
      ATTACHMENTS_BUCKET,
      entry.attachmentStoragePath,
      DOWNLOAD_TTL_SECONDS,
    );

    return NextResponse.redirect(url, 307);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not open the receipt' },
      { status: 500 },
    );
  }
}
