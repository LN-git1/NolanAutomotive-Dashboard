/**
 * Filename for a downloaded or shared invoice.
 *
 * Deliberately NOT in `build.ts`: that module is `server-only` and pulls in the
 * database, which would make this pure string function untestable. It is also
 * the piece most likely to be wrong in a way only a test catches.
 *
 * The number alone is meaningless in a WhatsApp thread or a phone's downloads
 * folder, so the customer and registration ride along. Non-ASCII is stripped
 * because the value goes into a `Content-Disposition` header, where a raw
 * "Séamus" would produce a mangled or rejected filename.
 */
export function buildInvoiceFileName(
  invoiceNumber: string,
  customerName?: string | null,
  registration?: string | null,
): string {
  const parts = [invoiceNumber, customerName, registration]
    .map((part) =>
      (part ?? '')
        // Strip anything outside printable ASCII, then the characters that are
        // illegal in a filename on Windows, macOS or Linux.
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim(),
    )
    .filter((part) => part !== '');

  return `${parts.join(' - ')}.pdf`;
}
