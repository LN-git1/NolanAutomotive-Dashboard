import 'server-only';

import { recordError } from '@/lib/errors/log';

/**
 * Run a mutation and turn a thrown failure into `{ ok: false, error }`.
 *
 * Server actions that throw reach the dashboard error boundary, which tells the
 * owner not to touch anything — after a write that may or may not have landed.
 * A transient pooler blip should instead come back as an inline error the
 * caller can show. Writes are never retried here: re-running one can
 * double-apply it (see `lib/db/retry.ts`).
 *
 * Because the error boundary no longer sees these failures, the same
 * matrix-dash webhook it would have fired is sent from here.
 *
 * Call `requireSession()` BEFORE this, not inside `fn`: it signals a redirect
 * by throwing, and that must propagate.
 */
export async function guardedWrite<T extends { ok: boolean; error?: string }>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[action:${label}] failed: ${message.slice(0, 300)}`);
    await Promise.all([
      notifyWriteFailure(label, message),
      recordError({ source: 'action', label, message }),
    ]);
    return { ok: false, error: 'Could not save that just now — please try again.' };
  }
}

/** Best-effort and bounded: a dead webhook must never delay or break the reply. */
async function notifyWriteFailure(label: string, message: string): Promise<void> {
  try {
    const webhookUrl = process.env.MATRIX_DASH_WEBHOOK_URL;
    const webhookToken = process.env.MATRIX_DASH_WEBHOOK_TOKEN;
    // The URL may be a template holding REPLACE_WITH_REAL_TOKEN; only an unset
    // or still-placeholder token means the webhook isn't configured.
    if (!webhookUrl || !webhookToken || webhookToken.startsWith('SET_TOKEN_FROM')) return;

    await fetch(webhookUrl.replace('REPLACE_WITH_REAL_TOKEN', webhookToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'notify',
        title: `Write failure — nolan-automotive/dashboard (${label})`,
        body:
          `Source: nolan-automotive/dashboard (action: ${label}). Category: error. ` +
          `Message: ${message.slice(0, 400)}. Location: lib/actions/safe.ts. ` +
          'Next step: check Vercel Runtime Logs for [action:...] lines.',
        kind: 'error',
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Silent — the console.error above is the durable signal.
  }
}
