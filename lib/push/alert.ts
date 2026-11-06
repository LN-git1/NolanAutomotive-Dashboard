import { runAfterResponse } from './after';
import type { SystemAlertKind } from './payload';

/**
 * Send an app alert after the response has gone, from anywhere in the app that
 * has just noticed a problem.
 *
 * Deliberately tiny, with only type imports besides `runAfterResponse`: it is
 * pulled into error handlers and write paths, so it must cost nothing to load
 * and can never itself be the thing that fails. The push code is loaded only
 * when an alert is actually sent, and every failure is swallowed.
 */
export function alertAfterResponse(kind: SystemAlertKind, throttleMinutes?: number): void {
  runAfterResponse(async () => {
    const { sendSystemAlert } = await import('./system');
    await sendSystemAlert(kind, throttleMinutes);
  });
}
