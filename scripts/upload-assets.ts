/**
 * Publish the invoice template and fonts to R2.
 *
 *   pnpm assets:upload            # uses .env.production.local
 *
 * The files in `lib/pdf/template` and `lib/pdf/fonts` remain the source of
 * truth in git; this pushes them to object storage, which is where the running
 * app reads them from. Run it once per environment, and again whenever the
 * template or fonts change.
 *
 * Idempotent — it overwrites by key.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  FONT_BOLD_KEY,
  FONT_REGULAR_KEY,
  TEMPLATE_KEY,
  loadInvoiceAssets,
} from '../lib/pdf/assets';
import { INVOICES_BUCKET } from '../lib/storage/r2';
import { uploadBytes } from '../lib/storage/signedUrl';

const FILES: { localPath: string; key: string; contentType: string }[] = [
  {
    localPath: 'lib/pdf/template/invoice-template.pdf',
    key: TEMPLATE_KEY,
    contentType: 'application/pdf',
  },
  { localPath: 'lib/pdf/fonts/regular.ttf', key: FONT_REGULAR_KEY, contentType: 'font/ttf' },
  { localPath: 'lib/pdf/fonts/bold.ttf', key: FONT_BOLD_KEY, contentType: 'font/ttf' },
];

async function main() {
  console.log(`Publishing invoice assets to ${INVOICES_BUCKET}\n`);

  for (const file of FILES) {
    const bytes = await readFile(path.join(process.cwd(), file.localPath));
    await uploadBytes(INVOICES_BUCKET, file.key, bytes, file.contentType);
    console.log(`  ${file.key}  (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
  }

  // Read them straight back through the same path the app uses, so a broken
  // upload is caught here rather than on the first invoice.
  const assets = await loadInvoiceAssets();
  console.log(
    `\nVerified via loadInvoiceAssets(): template ${assets.template.byteLength} bytes, ` +
      `fonts ${assets.regular.byteLength} + ${assets.bold.byteLength} bytes.`,
  );

  if (String.fromCharCode(...assets.template.slice(0, 4)) !== '%PDF') {
    throw new Error('Template does not begin with %PDF — the upload is corrupt.');
  }

  console.log('Assets published.');
}

main().catch((error) => {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
