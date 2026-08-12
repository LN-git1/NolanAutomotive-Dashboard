import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { LOGIN_PATH, SESSION_COOKIE_NAME } from './constants';
import { verifySessionToken } from './session';

/**
 * Server-side session helpers.
 *
 * `middleware.ts` already gates every route, so these are defence in depth:
 * if the middleware matcher is ever misconfigured, pages and route handlers
 * still refuse to serve data. Cheap insurance on an app whose entire contents
 * are customer PII.
 */

export async function hasValidSession(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
}

/** For pages and layouts: bounce to the login screen when unauthenticated. */
export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) {
    redirect(LOGIN_PATH);
  }
}

/**
 * For route handlers: returns a 401 Response to short-circuit with, or null
 * when the caller is authenticated.
 *
 *   const denied = await requireApiSession();
 *   if (denied) return denied;
 */
export async function requireApiSession(): Promise<Response | null> {
  if (await hasValidSession()) return null;

  return Response.json({ error: 'Unauthorised' }, { status: 401 });
}
