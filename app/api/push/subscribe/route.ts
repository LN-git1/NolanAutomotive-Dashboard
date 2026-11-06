import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';
import { isAllowedPushEndpoint } from '@/lib/push/endpoints';
import { cleanTopics } from '@/lib/push/topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** More than this many devices means something is wrong; refuse to grow the table. */
const MAX_DEVICES = 25;

const subscribeSchema = z.object({
  endpoint: z.string().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
  topics: z.array(z.string()).max(20),
});

const unsubscribeSchema = z.object({ endpoint: z.string().max(2048) });

/** Register this device (or update its keys and topics: the app re-confirms on every open). */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  if (!isAllowedPushEndpoint(endpoint)) {
    return Response.json({ error: 'That push service is not supported' }, { status: 400 });
  }

  const topics = cleanTopics(parsed.data.topics);

  try {
    const existing = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);

    if (existing.length === 0) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions);
      if (n >= MAX_DEVICES) {
        return Response.json({ error: 'Too many devices are registered' }, { status: 409 });
      }
    }

    await db
      .insert(pushSubscriptions)
      .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, topics })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: keys.p256dh, auth: keys.auth, topics, lastSeenAt: new Date() },
      });
  } catch {
    return Response.json({ error: 'Could not save this device' }, { status: 500 });
  }

  return Response.json({ ok: true, topics });
}

/** Forget this device, on request or on sign-out. Idempotent: forgetting twice is fine. */
export async function DELETE(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  } catch {
    return Response.json({ error: 'Could not remove this device' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
