import 'server-only';

import { randomUUID } from 'node:crypto';

import { getSupabaseAdmin } from './supabaseAdmin';

/**
 * All file access goes through short-lived signed URLs minted here, server-side.
 * Buckets stay private; no anon key or public bucket is ever involved.
 */

/** Inline viewing (image previews). Short — the page re-mints on reload. */
export const VIEW_TTL_SECONDS = 120;
/** Explicit download click; longer so a slow connection still completes. */
export const DOWNLOAD_TTL_SECONDS = 900;

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
 * Mint a signed URL the browser can PUT bytes directly to.
 *
 * Uploads deliberately bypass the Next.js server: Vercel caps serverless
 * request bodies at roughly 4.5MB, and a photo from a phone camera routinely
 * exceeds that. Proxying the bytes would break on exactly the files the owner
 * most wants to attach.
 */
export async function createSignedUploadUrl(bucket: string, storagePath: string) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(`Could not create upload URL: ${error?.message ?? 'unknown error'}`);
  }

  return { signedUrl: data.signedUrl, token: data.token, path: storagePath };
}

export async function createSignedDownloadUrl(
  bucket: string,
  storagePath: string,
  ttlSeconds: number = VIEW_TTL_SECONDS,
  options?: { download?: string },
) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(storagePath, ttlSeconds, options?.download ? { download: options.download } : undefined);

  if (error || !data) {
    throw new Error(`Could not create download URL: ${error?.message ?? 'unknown error'}`);
  }

  return data.signedUrl;
}

/** Upload bytes generated on the server (used for finalised invoice PDFs). */
export async function uploadBytes(
  bucket: string,
  storagePath: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const { error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .upload(storagePath, bytes, { contentType, upsert: true });

  if (error) {
    throw new Error(`Could not upload ${storagePath}: ${error.message}`);
  }

  return storagePath;
}

export async function removeObject(bucket: string, storagePath: string) {
  const { error } = await getSupabaseAdmin().storage.from(bucket).remove([storagePath]);
  if (error) {
    throw new Error(`Could not delete ${storagePath}: ${error.message}`);
  }
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

  // Supabase caps a single remove() call, so send it in chunks.
  const CHUNK = 100;
  for (let index = 0; index < paths.length; index += CHUNK) {
    try {
      await getSupabaseAdmin().storage.from(bucket).remove(paths.slice(index, index + CHUNK));
    } catch {
      // Ignored on purpose — see above.
    }
  }

  return paths.length;
}
