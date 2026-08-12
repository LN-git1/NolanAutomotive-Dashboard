import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Credential check for the single admin user.
 *
 * The subtlety worth spelling out: `crypto.timingSafeEqual` THROWS when the two
 * buffers differ in length, and a submitted password will essentially never
 * happen to match the configured one byte-for-byte in length. Comparing the raw
 * strings would therefore crash on nearly every failed login.
 *
 * Hashing both sides to a fixed 32-byte SHA-256 digest first makes the lengths
 * always equal, so the timing-safe comparison is both valid and constant-time
 * with respect to how much of the password matched.
 *
 * Node runtime only — `node:crypto` is unavailable on Edge, which is why the
 * login route pins `runtime = 'nodejs'`.
 */

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function assertCredentialsConfigured(): void {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new Error(
      'ADMIN_USERNAME and ADMIN_PASSWORD must both be set. See .env.example.',
    );
  }
}

/**
 * Both comparisons always run — no short-circuit on a wrong username — so the
 * response time does not reveal which half was wrong.
 */
export function checkCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) return false;

  const usernameOk = safeEquals(username, expectedUsername);
  const passwordOk = safeEquals(password, expectedPassword);

  return usernameOk && passwordOk;
}
