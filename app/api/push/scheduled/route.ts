import { z } from 'zod';

import { readSmallJson } from '@/lib/push/body';
import { claimPush, prunePushClaims, releasePush } from '@/lib/push/claims';
import { dublinClock, isMorningWindow } from '@/lib/push/dublin';
import { collectMorningFacts } from '@/lib/push/morning';
import { buildPayload, morningPayload } from '@/lib/push/payload';
import { hasValidBearer } from '@/lib/push/secret';
import { sendPush } from '@/lib/push/send';
import { notifyBuilder, sendBuildResult } from '@/lib/push/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Notifications that go out on a schedule, called by GitHub Actions (the app has
 * no login for a scheduler, so `proxy.ts` leaves exactly this path out of the
 * session gate and this handler checks its own secret).
 *
 *   POST ?job=morning            the 9am summary, every day of the week
 *   POST ?job=morning&dryRun=1   show what would be sent, send nothing, claim nothing
 *   POST ?job=deploy             the result of the checks run after a new version
 *                                goes live (.github/workflows/deploy-check.yml)
 *
 * It answers 404 to a request without the secret, before reading anything else. The same secret as the activity email is used on purpose:
 * it already lives in both GitHub and Vercel, so there is one fewer thing to set
 * up, and both endpoints are "a scheduler may call me".
 */
export async function POST(request: Request) {
  if (!hasValidBearer(request, process.env.DIGEST_SECRET)) {
    return new Response('Not found', { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const job = params.get('job');
  const dryRun = params.get('dryRun') === '1';

  if (job === 'deploy') return handleDeploy(request, dryRun);

  if (job !== 'morning') {
    return Response.json({ error: 'Unknown job' }, { status: 400 });
  }

  const now = new Date();
  const clock = dublinClock(now);

  if (!dryRun && !isMorningWindow(now)) {
    return Response.json({ sent: false, skipped: 'outside the 9am window', dublinTime: `${clock.hour}:${String(clock.minute).padStart(2, '0')}` });
  }

  const facts = await collectMorningFacts(clock.date);
  const payload = morningPayload(facts);

  if (dryRun) {
    return Response.json({ dryRun: true, date: clock.date, payload });
  }

  const key = `morning:${clock.date}`;

  let won: boolean;
  try {
    won = await claimPush(key);
  } catch {
    // The notification tables are not there yet (the code was deployed before
    // the database change) or the database is struggling. Say so plainly rather
    // than failing with a bare 500, so the scheduler's log explains itself.
    return Response.json({ sent: false, error: 'notification tables are not ready' }, { status: 503 });
  }
  if (!won) {
    return Response.json({ sent: false, skipped: 'already sent today', date: clock.date });
  }

  const result = await sendPush('morning', payload);

  // Nothing could be attempted (keys not set up) or every attempt failed:
  // give the claim back so the next scheduled run, still inside the window,
  // tries again. Nobody subscribed is a clean success: nothing to retry.
  if (!result.configured || (result.attempted > 0 && result.delivered === 0)) {
    await releasePush(key);
  }

  await prunePushClaims();

  return Response.json({ sent: result.delivered > 0, date: clock.date, ...result });
}

const deploySchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/, 'Not a commit id'),
  failures: z.array(z.string().max(200)).max(20),
});

/**
 * The outcome of the checks that run after each new version goes live: a
 * notification to the devices that want app alerts, and, when a check failed,
 * a message to ZB Automations (the builder) through the usual webhook so the
 * problem is looked at without anyone having to notice it first.
 */
async function handleDeploy(request: Request, dryRun: boolean) {
  const parsed = deploySchema.safeParse(await readSmallJson(request));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid deploy result' }, { status: 400 });
  }

  const { sha, failures } = parsed.data;
  const payload = buildPayload({ sha, failures });

  if (dryRun) return Response.json({ dryRun: true, payload });

  // If the notification tables are not ready, the devices cannot be told, but a
  // failed check must still reach ZB Automations: that is the whole point.
  let result: 'sent' | 'duplicate' | 'unavailable';
  try {
    result = await sendBuildResult({ sha, failures });
  } catch {
    result = 'unavailable';
  }

  if (failures.length > 0 && result !== 'duplicate') {
    await notifyBuilder({
      title: `New version failed its checks — nolan-automotive/dashboard (${sha.slice(0, 7)})`,
      body:
        `Source: nolan-automotive/dashboard (post-deploy checks). Category: error. ` +
        `Version ${sha.slice(0, 7)} went live but these checks failed: ${failures.join('; ')}. ` +
        'Location: .github/workflows/deploy-check.yml. Next step: open the dashboard, check the failing pages, and roll back or fix forward.',
      kind: 'error',
    });
  }

  return Response.json({ ok: result !== 'unavailable', result, failed: failures.length }, { status: result === 'unavailable' ? 503 : 200 });
}
