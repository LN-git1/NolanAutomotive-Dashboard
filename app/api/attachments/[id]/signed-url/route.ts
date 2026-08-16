import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { jobAttachments } from '@/lib/db/schema';
import {
  DOWNLOAD_TTL_SECONDS,
  VIEW_TTL_SECONDS,
  createSignedDownloadUrl,
} from '@/lib/storage/signedUrl';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';

export const runtime = 'nodejs';

/**
 * Mint a short-lived signed URL for one attachment.
 *
 * Auth-gated in three layers: middleware, `requireApiSession`, and the fact
 * that the bucket itself is private so the raw path is useless without a
 * signature. `?download=1` lengthens the TTL and sets a download disposition.
 *
 * Two response shapes:
 *
 *  - **`?redirect=1` → a 307 to the signed URL.** This is what the UI uses, so
 *    View and Download can be plain `<a href>` links. That matters: the previous
 *    version fetched this route for JSON and then called `window.open()`, which
 *    happens *after* an await and is therefore a programmatic popup. Desktop
 *    Chrome permits it; iOS Safari — and in particular the installed standalone
 *    PWA, which is how the owner actually uses this — does not, so View silently
 *    did nothing. A real link needs no JavaScript and cannot be popup-blocked.
 *    `/api/invoices/[id]/pdf` already worked this way; this brings attachments
 *    into line with it.
 *  - **JSON** (the default), kept for any programmatic caller.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;
  const params_ = new URL(request.url).searchParams;
  const wantsDownload = params_.get('download') === '1';
  const wantsRedirect = params_.get('redirect') === '1';

  const rows = await db
    .select()
    .from(jobAttachments)
    .where(eq(jobAttachments.id, id))
    .limit(1);

  const attachment = rows[0];
  if (!attachment) {
    return Response.json({ error: 'Attachment not found' }, { status: 404 });
  }

  try {
    const url = await createSignedDownloadUrl(
      ATTACHMENTS_BUCKET,
      attachment.storagePath,
      wantsDownload ? DOWNLOAD_TTL_SECONDS : VIEW_TTL_SECONDS,
      wantsDownload ? { download: attachment.fileName } : undefined,
    );

    if (wantsRedirect) {
      // NextResponse rather than the bare Web `Response.redirect`, which is
      // stricter about cross-origin targets from a Route Handler.
      const response = NextResponse.redirect(url, 307);
      // The signature expires in minutes; never let a proxy cache the hop.
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    return Response.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not sign URL' },
      { status: 500 },
    );
  }
}
