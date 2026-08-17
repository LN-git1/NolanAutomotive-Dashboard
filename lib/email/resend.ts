import 'server-only';

import { Resend } from 'resend';

/**
 * Transactional email — currently just the DB-down alert. SERVER ONLY.
 *
 * Lazy singleton, same shape as `getR2()`: the API key is read inside the
 * function (not at module scope) so a missing key doesn't crash the build,
 * only the first attempt to actually send.
 */

// A stable, known destination — not worth an env var the way the sender is.
const ALERT_RECIPIENT = 'lee@nolanautomotive.ie';

let cached: Resend | null = null;

function getResendClient(): Resend {
  if (cached) return cached;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY must be set. See .env.example.');
  }

  cached = new Resend(apiKey);
  return cached;
}

/**
 * Unlike the recipient, this depends entirely on which domain gets verified
 * in Resend during setup — an env var rather than a guessed hardcoded value,
 * so a mismatch fails loudly here instead of silently as a Resend
 * `invalid_from_address` error swallowed by the health route's catch.
 */
function getAlertSender(): string {
  const sender = process.env.RESEND_FROM;
  if (!sender) {
    throw new Error('RESEND_FROM must be set. See .env.example.');
  }

  return sender;
}

/**
 * Fires from `/api/health`'s catch block on every failed check — no dedup, a
 * multi-day outage should keep nagging. Never throws: the caller wraps this
 * in its own try/catch anyway, but `resend.emails.send()` itself resolves
 * with `{ error }` rather than throwing on an API-level failure (invalid key,
 * unverified domain, etc.), so that's surfaced as a thrown error here for the
 * caller's catch block to pick up uniformly.
 */
export async function sendDbDownAlert(detail: string): Promise<void> {
  const resend = getResendClient();

  const { error } = await resend.emails.send({
    from: getAlertSender(),
    to: ALERT_RECIPIENT,
    subject: 'Nolan Automotive dashboard: database unreachable',
    text: `The dashboard's daily health check failed.\n\nError: ${detail}\n\nTime: ${new Date().toISOString()}`,
  });

  if (error) {
    throw new Error(`Resend rejected the alert email: ${error.message}`);
  }
}
