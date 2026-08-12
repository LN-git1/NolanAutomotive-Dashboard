import { cookies } from 'next/headers';

import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';

export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  return Response.json({ ok: true });
}
