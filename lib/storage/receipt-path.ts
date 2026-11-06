/**
 * Is this storage path one of THIS supplier's own receipt files?
 *
 * A receipt path is stored on a supplier entry and later used to sign a download
 * link and, when the entry is deleted, to DELETE that object. So a path must
 * never be allowed to point at another supplier's file, or at a job photo or an
 * invoice. The only paths ever minted for a supplier receipt are
 * `suppliers/<supplierId>/<something>`, so that is the only shape accepted.
 *
 * Checked segment by segment rather than by searching for "..": a file named
 * `invoice..pdf` is perfectly good, while a segment that is exactly `..` or `.`
 * (or an empty one) is how a path climbs out of its folder.
 */
export function isOwnSupplierReceiptPath(path: string, supplierId: string): boolean {
  const prefix = `suppliers/${supplierId}/`;
  if (!path.startsWith(prefix)) return false;

  const rest = path.slice(prefix.length);
  if (rest.length === 0 || rest.length > 400) return false;
  if (/[\\\u0000-\u001f]/.test(rest)) return false; // backslashes and control characters

  return rest.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
