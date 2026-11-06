/**
 * A random v4 UUID for client components.
 *
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS or localhost).
 * On the live site that is always true, but on a plain `http://` address (a
 * phone testing a dev server over Wi-Fi) it is undefined and the form that
 * called it crashes while rendering. `crypto.getRandomValues()` is available in
 * every context, so it is the fallback. These ids are idempotency keys and list
 * keys, not secrets, but both paths are still cryptographically random.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
