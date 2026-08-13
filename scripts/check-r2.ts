/**
 * End-to-end check of the storage layer against real R2 buckets.
 *
 *   pnpm r2:check
 *
 * Exercises the actual functions the app uses — not a hand-rolled S3 call — so
 * a credential, bucket-name, endpoint or signing mistake surfaces here rather
 * than as a failed upload on the live site. Cleans up after itself.
 *
 * Prints no secrets.
 */

import {
  buildInvoicePath,
  buildJobAttachmentPath,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  removeObject,
  uploadBytes,
} from '../lib/storage/signedUrl';
import { ATTACHMENTS_BUCKET, INVOICES_BUCKET } from '../lib/storage/r2';

function ok(label: string, detail = '') {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`Buckets: ${ATTACHMENTS_BUCKET} / ${INVOICES_BUCKET}`);
  console.log(`Account: ${(process.env.R2_ACCOUNT_ID ?? '').slice(0, 6)}… (endpoint reachable check follows)\n`);

  // --- 1. Server-side upload, the path finalised invoices take -------------
  const invoicePath = buildInvoicePath('TEST-CHECK-0001');
  const pdfBytes = new TextEncoder().encode('%PDF-1.4 nolan r2 connectivity check');

  await uploadBytes(INVOICES_BUCKET, invoicePath, pdfBytes, 'application/pdf');
  ok('server upload to invoices bucket', invoicePath);

  // --- 2. Presigned download, the path viewing/downloading takes -----------
  const downloadUrl = await createSignedDownloadUrl(INVOICES_BUCKET, invoicePath, 120);
  const downloaded = await fetch(downloadUrl);
  if (!downloaded.ok) throw new Error(`presigned GET failed: ${downloaded.status}`);
  const body = await downloaded.text();
  if (!body.startsWith('%PDF')) throw new Error('presigned GET returned unexpected content');
  ok('presigned download URL', `${downloaded.status}, ${body.length} bytes`);

  // --- 3. Download with a filename, as the download button does ------------
  const namedUrl = await createSignedDownloadUrl(INVOICES_BUCKET, invoicePath, 120, {
    download: 'NA-TEST-0001.pdf',
  });
  const named = await fetch(namedUrl);
  const disposition = named.headers.get('content-disposition') ?? '';
  if (!disposition.includes('NA-TEST-0001.pdf')) {
    throw new Error(`expected filename in content-disposition, got: ${disposition}`);
  }
  ok('download disposition', disposition);

  /**
   * 4. The browser upload path — the one most likely to be misconfigured,
   * because the PUT must send exactly the Content-Type the URL was signed for.
   */
  const attachmentPath = buildJobAttachmentPath(
    '00000000-0000-4000-8000-000000000000',
    'connectivity check.png',
  );
  const contentType = 'image/png';
  const { signedUrl } = await createSignedUploadUrl(ATTACHMENTS_BUCKET, attachmentPath, contentType);

  const put = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new TextEncoder().encode('not really a png, just bytes'),
  });
  if (!put.ok) throw new Error(`presigned PUT failed: ${put.status} ${await put.text()}`);
  ok('presigned upload URL (matching content-type)', `${put.status}`);

  // 5. And prove the signature is actually bound to that content type.
  const mismatched = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new TextEncoder().encode('should be rejected'),
  });
  if (mismatched.ok) {
    console.log('  WARN  a mismatched Content-Type was accepted — signature is not bound to it');
  } else {
    ok('mismatched content-type rejected', `${mismatched.status} as expected`);
  }

  // --- 6. Cleanup ----------------------------------------------------------
  await removeObject(INVOICES_BUCKET, invoicePath);
  await removeObject(ATTACHMENTS_BUCKET, attachmentPath);
  ok('cleanup', 'both test objects deleted');

  const gone = await fetch(await createSignedDownloadUrl(INVOICES_BUCKET, invoicePath, 60));
  if (gone.ok) throw new Error('deleted object is still readable');
  ok('deleted object no longer readable', `${gone.status}`);

  console.log('\nR2 is correctly configured.');
}

main().catch((error) => {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  console.error(
    '\nCommon causes: wrong bucket names, token not scoped to both buckets, ' +
      'wrong account ID, or the token lacking Object Read & Write.',
  );
  process.exit(1);
});
