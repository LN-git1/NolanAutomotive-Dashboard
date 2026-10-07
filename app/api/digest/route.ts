import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { digestRuns, errorLog } from '@/lib/db/schema';
import { collectDigest } from '@/lib/digest/collect';
import { renderDigest, renderDigestDbDown } from '@/lib/digest/render';
import { alignedWindow, trailingWindow } from '@/lib/digest/window';
import { sendDigestEmail } from '@/lib/email/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The 3-hourly digest email.
 *
 * Called by `.github/workflows/digest.yml` every 3 hours (Vercel's free plan
 * only allows a daily cron). Carries its own `DIGEST_SECRET` and answers 404 to
 * anything without it, like `/api/health` — it is excluded from the session
 * gate in `proxy.ts` because the scheduler has no login.
 *
 *   (default)        the last COMPLETE 3-hour block, aligned to UTC multiples of 3h
 *   ?hours=N         a window of N hours ending now (previews / catch-up)
 *   ?dryRun=1        return the HTML instead of emailing it
 *
 * Two independent schedulers call this (GitHub Actions and Supabase pg_cron), so
 * it is idempotent per window: the window end is claimed in `digest_runs`
 * before sending, a duplicate call for a window already sent is a no-op, and a
 * failed send releases the claim so the next caller retries it.
 */
async function handle(request: Request) {
  const secret = process.env.DIGEST_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Not found', { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const hoursParam = Number(params.get('hours'));
  const window =
    Number.isFinite(hoursParam) && hoursParam >= 1 && hoursParam <= 48
      ? trailingWindow(new Date(), Math.floor(hoursParam))
      : alignedWindow(new Date());
  const dryRun = params.get('dryRun') === '1';
  // Only the scheduled (aligned) windows are de-duplicated; ?hours= previews are not.
  const dedupe = !dryRun && !(Number.isFinite(hoursParam) && hoursParam >= 1);

  let claimed = false;
  if (dedupe) {
    try {
      // A claim older than 10 minutes with no sentAt is a crashed run: take it over.
      await db
        .delete(digestRuns)
        .where(
          and(
            eq(digestRuns.windowEnd, window.end),
            isNull(digestRuns.sentAt),
            lt(digestRuns.claimedAt, sql`now() - interval '10 minutes'`),
          ),
        );
      const won = await db
        .insert(digestRuns)
        .values({ windowEnd: window.end })
        .onConflictDoNothing()
        .returning({ windowEnd: digestRuns.windowEnd });
      if (won.length === 0) {
        return Response.json({ sent: false, skipped: 'window already claimed or sent', window: { end: window.end.toISOString() } });
      }
      claimed = true;
    } catch (error) {
      // The claim table is unreachable (database trouble). Better a possible
      // duplicate than a missing digest — carry on and let the DB-down path report it.
      console.error('[digest] could not claim window:', error);
    }
  }

  let rendered;
  let errorCount = 0;
  let dbDown = false;
  try {
    const data = await collectDigest(window.start, window.end);
    errorCount = data.errors.length;
    rendered = renderDigest(data);
  } catch (error) {
    // The database itself is unreadable: still send *something*, because a
    // silent digest is exactly when the owner most needs to hear about it.
    dbDown = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error('[digest] could not read the database:', message);
    rendered = renderDigestDbDown({ windowStart: window.start, windowEnd: window.end }, message);
  }

  if (dryRun) {
    return new Response(rendered.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  try {
    await sendDigestEmail(rendered);
  } catch (error) {
    console.error('[digest] send failed:', error);
    if (claimed) {
      // Release the claim so the other scheduler (or the retry) can try again.
      await db.delete(digestRuns).where(eq(digestRuns.windowEnd, window.end)).catch(() => {});
    }
    return Response.json(
      { sent: false, error: error instanceof Error ? error.message : 'send failed' },
      { status: 502 },
    );
  }

  if (claimed) {
    await db
      .update(digestRuns)
      .set({ sentAt: new Date() })
      .where(eq(digestRuns.windowEnd, window.end))
      .catch(() => {});
  }

  if (!dbDown) {
    // Housekeeping: the error log only needs a month of history.
    try {
      await db.delete(digestRuns).where(lt(digestRuns.windowEnd, sql`now() - interval '60 days'`));
      await db.delete(errorLog).where(lt(errorLog.occurredAt, sql`now() - interval '30 days'`));
    } catch {
      // Best-effort.
    }
  }

  return Response.json({
    sent: true,
    dbDown,
    errors: errorCount,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
  });
}

export const GET = handle;
export const POST = handle;
