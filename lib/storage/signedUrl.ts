import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getR2 } from './r2';

/**
 * All file access goes through short-lived presigned URLs minted here,
 * server-side. Buckets stay private; no public URL is ever involved.
 */

/** Inline viewing (image previews). Short — the page re-mints on reload. */
export const VIEW_TTL_SECONDS = 120;
/** Explicit download click; longer so a slow connection still completes. */
export const DOWNLOAD_TTL_SECONDS = 900;
/** Upload window. Long enough for a large photo on workshop signal. */
export const UPLOAD_TTL_SECONDS = 300;

/** Strip anything that could escape the intended prefix or break a URL. */
export function sanitiseFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
  return cleaned.slice(0, 120) || 'file';
}

export function buildJobAttachmentPath(jobId: string, fileName: string): string {
  return `jobs/${jobId}/${randomUUID()}-${sanitiseFileName(fileName)}`;
}

export function buildSupplierBillPath(supplierId: string, fileName: string): string {
  return `suppliers/${supplierId}/${randomUUID()}-${sanitiseFileName(fileName)}`;
}

export function buildInvoicePath(invoiceNumber: string): string {
  return `invoices/${sanitiseFileName(invoiceNumber)}.pdf`;
}

/**
 * Mint a presigned URL the browser can PUT bytes directly to.
 *
 * Uploads deliberately bypass the Next.js server: Vercel caps serverless
 * request bodies at roughly 4.5MB, and a photo from a phone camera routinely
 * exceeds that. Proxying the bytes would break on exactly the files the owner
 * most wants to attach.
 *
 * `contentType` is part of the signature, not a hint. The browser MUST send the
 * identical `Content-Type` header on its PUT or R2 rejects it as a signature
 * mismatch — which is why the upload-url endpoint takes the file's MIME type
 * from the client rather than guessing.
 */
export async function createSignedUploadUrl(
  bucket: string,
  storagePath: string,
  contentType: string,
) {
  const signedUrl = await getSignedUrl(
    getR2(),
    new PutObjectCommand({ Bucket: bucket, Key: storagePath, ContentType: contentType }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );

  return { signedUrl, path: storagePath };
}

export async function createSignedDownloadUrl(
  bucket: string,
  storagePath: string,
  ttlSeconds: number = VIEW_TTL_SECONDS,
  options?: { download?: string },
) {
  return getSignedUrl(
    getR2(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      // Turns the response into a download with the original filename rather
      // than the opaque UUID-prefixed storage key.
      ...(options?.download
        ? { ResponseContentDisposition: `attachment; filename="${options.download}"` }
        : {}),
    }),
    { expiresIn: ttlSeconds },
  );
}

/** Upload bytes generated on the server (used for finalised invoice PDFs). */
export async function uploadBytes(
  bucket: string,
  storagePath: string,
  bytes: Uint8Array,
  contentType: string,
) {
  await getR2().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  return storagePath;
}

export async function removeObject(bucket: string, storagePath: string) {
  await getR2().send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: [{ Key: storagePath }] },
    }),
  );
}

/**
 * Best-effort bulk delete, used by the factory reset.
 *
 * Deliberately does not throw: the database rows are already gone by the time
 * this runs, and failing the whole reset because one orphaned object could not
 * be removed would be worse than leaving it. Returns how many paths it was
 * asked to remove so the caller can report honestly.
 */
export async function removeObjects(bucket: string, storagePaths: string[]): Promise<number> {
  const paths = storagePaths.filter(Boolean);
  if (paths.length === 0) return 0;

  // S3/R2 cap a single DeleteObjects call at 1000 keys.
  const CHUNK = 1000;
  for (let index = 0; index < paths.length; index += CHUNK) {
    try {
      await getR2().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: paths.slice(index, index + CHUNK).map((Key) => ({ Key })) },
        }),
      );
    } catch {
      // Ignored on purpose — see above.
    }
  }

  return paths.length;
}
