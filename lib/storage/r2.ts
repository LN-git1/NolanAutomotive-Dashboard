import 'server-only';

import { S3Client } from '@aws-sdk/client-s3';

/**
 * Cloudflare R2 client. SERVER ONLY.
 *
 * R2 speaks the S3 API, so the standard AWS SDK works against it with
 * `region: 'auto'` and an account-scoped endpoint. Chosen over Supabase Storage
 * because the free tier gives 10GB with no egress charges and, critically, does
 * not pause with the database project.
 *
 * These credentials can read and write every object in both buckets, so they
 * must never reach the browser. The `server-only` import above turns an
 * accidental client import into a build error, and none of these variables are
 * prefixed `NEXT_PUBLIC_` — that prefix would inline the value at build time
 * and leak it into the client bundle.
 *
 * Both buckets are private. Nothing is ever served from a public URL; the
 * browser only sees short-lived presigned URLs minted here.
 */

export const ATTACHMENTS_BUCKET = process.env.R2_ATTACHMENTS_BUCKET ?? 'nolan-attachments';
export const INVOICES_BUCKET = process.env.R2_INVOICES_BUCKET ?? 'nolan-invoices';

let cached: S3Client | null = null;

export function getR2(): S3Client {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set. See .env.example.',
    );
  }

  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return cached;
}
