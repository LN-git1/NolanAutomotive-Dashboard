import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Health check, and — more importantly — the thing that keeps the database from
 * being paused.
 *
 * Supabase's free tier pauses a project after roughly a week of inactivity. For
 * a garage that might not raise an invoice for a quiet week, that would mean
 * arriving at the dashboard to find it down and needing a manual restore. A
 * daily Vercel cron hits this endpoint, and the `SELECT 1` is the whole point:
 * a static 200 would keep Vercel happy while letting Postgres go idle anyway.
 *
 * Protected by `CRON_SECRET`, which Vercel Cron sends automatically as a bearer
 * token when that variable is set. It answers 404 rather than 401 to anything
 * without it, so an unauthenticated caller cannot even confirm the route exists.
 * When the secret is unset (local development) the check is skipped.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Not found', { status: 404 });
  }

  try {
    await db.execute(sql`SELECT 1`);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Database unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
