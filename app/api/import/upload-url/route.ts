import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { buildImportPath, createSignedUploadUrl } from '@/lib/storage/signedUrl';

export const runtime = 'nodejs';

const requestSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
});

/**
 * Mint a presigned upload URL for a screenshot or voice recording being
 * imported into a new job. Deliberately separate from
 * `/api/attachments/upload-url`: that route's path builder requires a
 * `jobId`, which doesn't exist yet at import time, and these objects are
 * never turned into a `job_attachments` row — they're parsed once by
 * `/api/import/parse` and then best-effort deleted.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  const storagePath = buildImportPath(parsed.data.fileName);

  try {
    const signed = await createSignedUploadUrl(ATTACHMENTS_BUCKET, storagePath, parsed.data.mimeType);
    return Response.json({ uploadUrl: signed.signedUrl, storagePath: signed.path });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not create upload URL' },
      { status: 500 },
    );
  }
}
