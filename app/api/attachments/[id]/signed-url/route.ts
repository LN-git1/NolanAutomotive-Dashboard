import { eq } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { jobAttachments } from '@/lib/db/schema';
import {
  DOWNLOAD_TTL_SECONDS,
  VIEW_TTL_SECONDS,
  createSignedDownloadUrl,
} from '@/lib/storage/signedUrl';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/supabaseAdmin';

export const runtime = 'nodejs';

/**
 * Mint a short-lived signed URL for one attachment.
 *
 * Auth-gated in three layers: middleware, `requireApiSession`, and the fact
 * that the bucket itself is private so the raw path is useless without a
 * signature. `?download=1` lengthens the TTL and sets a download disposition.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;
  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';

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

    return Response.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not sign URL' },
      { status: 500 },
    );
  }
}
