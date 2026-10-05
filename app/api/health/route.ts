import { sql } from 'drizzle-orm';
import { after } from 'next/server';

import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db/retry';
import { sendDbDownAlert } from '@/lib/email/resend';

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
    // Timed so the keep-alive cron doubles as a responsiveness monitor: a
    // database that answers but takes seconds is the early warning before the
    // page-level Suspense streams start stalling (see lib/db/retry.ts).
    const started = Date.now();
    // Same retry policy as every page read, so the health verdict matches
    // what the app itself experiences rather than a single lucky attempt.
    await withDbRetry('health:select-1', () => db.execute(sql`SELECT 1`));
    const dbMs = Date.now() - started;
    if (dbMs > 5000) {
      console.error(`[db] health check slow: SELECT 1 took ${dbMs}ms`);
    }
    return Response.json(
      { ok: true, dbMs },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database unreachable';

    // Scheduled via after() so a slow or broken Resend call can never delay
    // the 503 itself — the cron and any caller get the real status back
    // immediately either way.
    after(async () => {
      try {
        await sendDbDownAlert(message);
      } catch (alertError) {
        console.error('Failed to send DB-down alert email:', alertError);
      }
    });

    return Response.json(
      { ok: false, error: message },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
