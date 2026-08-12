import { NextResponse, type NextRequest } from 'next/server';

import { LOGIN_PATH, SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { verifySessionToken } from '@/lib/auth/session';

/**
 * The single gate in front of the entire application.
 *
 * (Next.js 16 renamed the `middleware` file convention to `proxy`; this is the
 * same request interceptor under the current name.)
 *
 * Everything is private — the only public surface is the login screen and the
 * login endpoint. Pages redirect when unauthenticated; API routes get a 401
 * rather than an HTML redirect so `fetch` callers see a usable error.
 *
 * Runs on the Edge runtime, which is why session verification uses `jose`
 * (Web Crypto) and never anything from `node:crypto`.
 */
export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
}

export const config = {
  /**
   * Everything except the login page, the login endpoint, Next.js build assets,
   * and the PWA install assets. This deliberately DOES cover `/api/**` — file
   * access and CSV exports must be gated too, not just pages.
   *
   * The manifest and icons MUST stay public: a browser fetches them before any
   * session exists, and if they redirect to the login page the install prompt
   * silently never appears and the home-screen icon falls back to a screenshot.
   * They expose nothing beyond the app's name and logo.
   */
  matcher: [
    '/((?!login|api/auth/login|_next/static|_next/image|favicon.ico|favicon-32.png|manifest.webmanifest|icons/).*)',
  ],
};
