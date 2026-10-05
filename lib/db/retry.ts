/**
 * Bounded retries for database READS.
 *
 * Background: the dashboard talks to Supabase Postgres through Supavisor (a
 * pgbouncer-style pooler) from Vercel serverless functions. That path drops or
 * stalls intermittently — a dead pooled connection here, pooler contention
 * there — and every dashboard page fans out several concurrent reads, so a
 * single blip used to surface as a full-page error boundary (React #441, the
 * "Can't reach your data right now" screen with a rotating Reference digest).
 *
 * Retrying is the correct permanent response to this failure class: the
 * connection between a serverless function and a managed pooler can never be
 * made infallible from app code, so transient failures get absorbed here
 * instead of reaching the owner. Two deliberate boundaries:
 *
 * - READS ONLY. Never wrap a mutation: re-running a write can double-apply
 *   it, and the transactional guards (row locks, submission-key dedupe) are
 *   written for single execution. A failed write surfaces as an action error,
 *   not a page boundary, so it never needed this.
 * - TRANSIENT ONLY. Auth failures, missing relations (a migration that was
 *   never applied), and permission errors fail fast on the first attempt, so a
 *   real misconfiguration still errors loudly instead of burning seconds on
 *   retries that cannot help.
 *
 * Every attempt and the final give-up are logged via `console.error`, which
 * Vercel captures in Runtime Logs with the request attached. The error
 * boundary's Reference digest cannot be mapped back after the fact; these log
 * lines are what the next incident gets diagnosed from instead.
 */

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

/** Postgres SQLSTATEs that mean "the connection/pooler stumbled, try again". */
const TRANSIENT_SQLSTATES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '57014', // query_canceled (statement timeout under load — worth one more go)
]);

/** Node/driver-level failures that mean the same thing. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETRESET',
]);

/**
 * Failures that must NEVER be retried. A retry cannot fix these, and burning
 * attempts on them only delays the real signal:
 *
 * - 28xxx: auth is rejected (wrong/rotated password). Retrying also risks
 *   tripping Supavisor's auth-failure circuit breaker, which then blocks
 *   legitimate connections too.
 * - 42P01 / "relation does not exist": the schema is behind the code — almost
 *   always a migration that was generated but never applied to production.
 *   This must error immediately and visibly.
 * - 42501: permission denied — configuration, not weather.
 * - 23505: unique violation — a second attempt would just collide again
 *   (and this module is reads-only anyway; this is belt and braces).
 */
const FATAL_SQLSTATES = new Set(['28P01', '28000', '42P01', '42501', '23505']);

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTransientDbError(error: unknown): boolean {
  const code = errorCode(error);
  if (code && FATAL_SQLSTATES.has(code)) return false;

  const message = errorMessage(error);
  if (/password authentication failed|authentication failed|role .* does not exist/i.test(message)) {
    return false;
  }
  if (/relation .* does not exist/i.test(message)) return false;

  if (code && (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_CODES.has(code))) return true;
  // Supavisor's "new connections are temporarily blocked" back-off notice.
  if (/ECIRCUITBREAKER|temporarily blocked/i.test(message)) return true;
  if (/timed? ?out|timeout|connection (reset|closed|terminated)|terminating connection|server closed/i.test(message)) {
    return true;
  }

  // Unclassified errors get retried: a deterministic bug reproduces identically
  // on the next attempt and still surfaces, while an unlisted transient blip
  // gets absorbed. The fatal set above is what keeps real misconfiguration
  // from being masked.
  return true;
}

export interface DbRetryOptions {
  /** Total attempts including the first. Defaults to 3. */
  attempts?: number;
  /** First back-off delay in ms; doubles each retry. Defaults to 300. */
  baseDelayMs?: number;
  /** Overridable for tests so they never sleep for real. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run a database READ, retrying transient failures with back-off.
 *
 * `label` names the query (e.g. `'jobs:listJobs'`) and is the string to grep
 * for in Vercel Runtime Logs. Keep it stable — renaming a label orphans
 * history when comparing incidents.
 */
export async function withDbRetry<T>(
  label: string,
  // PromiseLike (not just Promise): Drizzle query builders are thenable but
  // are not Promise instances, and wrapping must accept them directly so call
  // sites stay a two-line change. `await` below handles either.
  fn: () => Promise<T> | PromiseLike<T>,
  opts: DbRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const code = errorCode(error) ?? 'unknown';
      const elapsed = Date.now() - started;

      if (!isTransientDbError(error) || attempt === attempts) {
        console.error(
          `[db] ${label} failed after ${attempt}/${attempts} attempt(s) ` +
            `(${code}, ${elapsed}ms): ${errorMessage(error).slice(0, 300)}`,
        );
        // Webhook notification to matrix-dash for any DB failure (fatal or
        // exhausted retries) — non-blocking, never delays the error.
        try {
          const webhookUrl = process.env.MATRIX_DASH_WEBHOOK_URL;
          const webhookToken = process.env.MATRIX_DASH_WEBHOOK_TOKEN;
          if (webhookUrl && webhookToken && !webhookUrl.includes('REPLACE_WITH_REAL')) {
            const webUrl = webhookUrl.replace('REPLACE_WITH_REAL_TOKEN', webhookToken);
            fetch(webUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                action: 'notify',
                title: `DB failure — nolan-automotive/dashboard (${label})`,
                body: 'Source: nolan-automotive/dashboard (query: ' + label + '). ' +
                  'Category: error. ' +
                  'Message: ' + String(errorMessage(error)).slice(0, 400) + '. ' +
                  'SQLSTATE/code: ' + code + '. ' +
                  'Attempts: ' + attempt + '/' + attempts + '. ' +
                  'Elapsed: ' + elapsed + 'ms. ' +
                  'Location: lib/db/retry.ts. ' +
                  'Next step: check Vercel Runtime Logs for [db] lines.',
                kind: 'error',
              }),
            }).catch(() => {
              // Silent — webhook is best-effort; the console.error above is the durable signal.
            });
          }
        } catch {
          // Silent.
        }
        throw error;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.error(
        `[db] ${label} attempt ${attempt}/${attempts} failed ` +
          `(${code}, ${elapsed}ms), retrying in ${delay}ms: ${errorMessage(error).slice(0, 200)}`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
