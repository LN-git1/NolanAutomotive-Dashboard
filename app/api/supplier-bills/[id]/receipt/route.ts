import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { supplierBills } from '@/lib/db/schema';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { DOWNLOAD_TTL_SECONDS, createSignedDownloadUrl } from '@/lib/storage/signedUrl';

export const runtime = 'nodejs';

/**
 * Open a supplier bill's receipt.
 *
 * Same shape as `/api/invoices/[id]/pdf` — redirect to a short-lived signed
 * URL rather than streaming the bytes through this function.
 *
 * This route did not exist before: a receipt could be uploaded via
 * `bill-form.tsx` and its path stored on the bill, but nothing could ever sign
 * a URL for it, so an uploaded receipt was permanently unreachable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;

  const rows = await db.select().from(supplierBills).where(eq(supplierBills.id, id)).limit(1);
  const bill = rows[0];

  if (!bill) {
    return Response.json({ error: 'Bill not found' }, { status: 404 });
  }

  if (!bill.attachmentStoragePath) {
    return Response.json({ error: 'This bill has no receipt attached' }, { status: 404 });
  }

  try {
    const url = await createSignedDownloadUrl(
      ATTACHMENTS_BUCKET,
      bill.attachmentStoragePath,
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
