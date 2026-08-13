import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import {
  buildJobAttachmentPath,
  buildSupplierBillPath,
  createSignedUploadUrl,
} from '@/lib/storage/signedUrl';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';

export const runtime = 'nodejs';

/**
 * `mimeType` is required, not optional: R2 signs the upload URL *for* a specific
 * Content-Type, and the browser's PUT must send exactly the same header or the
 * signature is rejected. Letting the client omit it would produce uploads that
 * fail with an opaque 403.
 */
const requestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('job'),
    jobId: z.string().uuid(),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
  }),
  z.object({
    kind: z.literal('supplier-bill'),
    supplierId: z.string().uuid(),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
  }),
]);

/**
 * Mint a one-shot presigned upload URL so the browser can PUT the file straight
 * to Cloudflare R2.
 *
 * The bytes deliberately do NOT pass through this server: Vercel caps a
 * serverless request body at roughly 4.5MB, and photos taken on a phone in the
 * workshop routinely exceed that. Proxying them would fail on exactly the files
 * the owner most wants to attach.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  const input = parsed.data;
  const storagePath =
    input.kind === 'job'
      ? buildJobAttachmentPath(input.jobId, input.fileName)
      : buildSupplierBillPath(input.supplierId, input.fileName);

  try {
    const signed = await createSignedUploadUrl(ATTACHMENTS_BUCKET, storagePath, input.mimeType);

    return Response.json({ uploadUrl: signed.signedUrl, storagePath: signed.path });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not create upload URL' },
      { status: 500 },
    );
  }
}
