import 'server-only';

import { claimPush, releasePush } from './claims';
import { buildPayload, systemPayload, type SystemAlertKind } from './payload';
import { sendPush } from './send';

/**
 * Tell the devices that want app alerts about a problem, at most once per
 * `throttleMinutes` for the same kind.
 *
 * Without the throttle one bad moment (a database that keeps failing, a page
 * that crashes on every load) would send a notification per failure and bury
 * the phone. The kind plus the current time bucket is the claim, so the first
 * failure in each bucket sends and the rest stay quiet.
 */
export async function sendSystemAlert(kind: SystemAlertKind, throttleMinutes = 30): Promise<void> {
  const bucket = Math.floor(Date.now() / (throttleMinutes * 60_000));
  const key = `system:${kind}:${bucket}`;

  if (!(await claimPush(key))) return;

  const result = await sendPush('system', systemPayload(kind));
  // Not set up yet: hand the claim back so a real problem is not swallowed
  // for half an hour just because the keys were added a minute later.
  if (!result.configured) await releasePush(key);
}

/**
 * The note after a new version goes live, once per version and outcome, so a
 * re-run of the checks does not buzz the phone twice. Says whether this call was
 * the first for that version and outcome.
 */
export async function sendBuildResult(input: { sha: string; failures: readonly string[] }): Promise<'sent' | 'duplicate'> {
  const outcome = input.failures.length === 0 ? 'ok' : 'failed';
  const key = `build:${input.sha}:${outcome}`;

  if (!(await claimPush(key))) return 'duplicate';

  const result = await sendPush('system', buildPayload(input));
  if (!result.configured) await releasePush(key);
  return 'sent';
}

/**
 * Message ZB Automations (the builder) through the same matrix-dash webhook the
 * rest of the app already uses for errors. Bounded and silent on failure: a
 * dead webhook must never break the check that is trying to report a problem.
 */
export async function notifyBuilder(input: { title: string; body: string; kind: 'error' | 'warning' | 'info' }): Promise<void> {
  try {
    const url = process.env.MATRIX_DASH_WEBHOOK_URL;
    const token = process.env.MATRIX_DASH_WEBHOOK_TOKEN;
    if (!url || !token || token.startsWith('SET_TOKEN_FROM')) return;

    const target = url.replace('REPLACE_WITH_REAL_TOKEN', token);
    // A URL that still holds the placeholder after substitution is not usable.
    if (target.includes('REPLACE_WITH_REAL')) return;

    await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'notify', ...input }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Silent: see above.
  }
}
