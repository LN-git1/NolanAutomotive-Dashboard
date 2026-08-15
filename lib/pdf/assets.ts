import 'server-only';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { INVOICES_BUCKET, getR2 } from '@/lib/storage/r2';

/**
 * The invoice template and the fonts used to stamp it.
 *
 * These are fetched from R2 rather than read from disk. The files still live in
 * the repository as the source of truth — `pnpm assets:upload` publishes them —
 * but the running app never touches a filesystem.
 *
 * Why: a `readFile` against `process.cwd()` depends on build-time file tracing
 * putting the right files in the right place, which is platform-specific and
 * fails in exactly the worst way — perfectly in dev, only in production, on the
 * single most important code path in the app.
 *
 * This originally changed while briefly targeting Cloudflare Workers, which has
 * no filesystem at all. It is kept on Vercel because it earned its place: the
 * hosting target moved twice inside two days, and an app that fetches its own
 * assets from object storage moves with it for free. Runs identically on
 * Vercel, on Workers, or on a plain Node server, with no build config.
 *
 * Cached for the lifetime of the isolate, so the ~1.2MB fetch happens once on a
 * cold start and never again.
 */

export const TEMPLATE_KEY = '_assets/invoice-template.pdf';
export const FONT_REGULAR_KEY = '_assets/regular.ttf';
export const FONT_BOLD_KEY = '_assets/bold.ttf';

export interface InvoiceAssets {
  template: Uint8Array;
  regular: Uint8Array;
  bold: Uint8Array;
}

let cached: InvoiceAssets | null = null;
/** De-duplicates concurrent cold starts so three requests fetch once, not thrice. */
let inFlight: Promise<InvoiceAssets> | null = null;

async function fetchObject(key: string): Promise<Uint8Array> {
  const result = await getR2().send(
    new GetObjectCommand({ Bucket: INVOICES_BUCKET, Key: key }),
  );

  if (!result.Body) {
    throw new Error(`Invoice asset "${key}" is empty in R2.`);
  }

  const bytes = await result.Body.transformToByteArray();

  if (bytes.byteLength === 0) {
    throw new Error(`Invoice asset "${key}" downloaded as zero bytes.`);
  }

  return bytes;
}

export async function loadInvoiceAssets(): Promise<InvoiceAssets> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const [template, regular, bold] = await Promise.all([
        fetchObject(TEMPLATE_KEY),
        fetchObject(FONT_REGULAR_KEY),
        fetchObject(FONT_BOLD_KEY),
      ]);

      cached = { template, regular, bold };
      return cached;
    } catch (error) {
      // Make the cause obvious: this fails identically whether the assets were
      // never uploaded or the credentials are wrong, and the difference matters.
      throw new Error(
        `Could not load the invoice template or fonts from R2. ` +
          `Run \`pnpm assets:upload\` if this is a new environment. ` +
          `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
