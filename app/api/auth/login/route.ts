import { cookies } from 'next/headers';
import { z } from 'zod';

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/constants';
import { checkCredentials } from '@/lib/auth/credentials';
import { createSessionToken } from '@/lib/auth/session';

/**
 * Node runtime is required: credential comparison uses `node:crypto`'s
 * `timingSafeEqual`, which does not exist on the Edge runtime.
 */
export const runtime = 'nodejs';

const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  let payload: unknown;

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    payload = await request.json().catch(() => null);
  } else {
    payload = Object.fromEntries(await request.formData());
  }

  const parsed = loginSchema.safeParse(payload);

  // A malformed body and a wrong password return the same generic message —
  // there is nothing useful to tell an attacker here.
  if (!parsed.success || !checkCredentials(parsed.data.username, parsed.data.password)) {
    return Response.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  const token = await createSessionToken();
  const store = await cookies();

  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return Response.json({ ok: true });
}
