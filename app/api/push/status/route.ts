import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import { readSmallJson } from '@/lib/push/body';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';
import { cleanTopics } from '@/lib/push/topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ endpoint: z.string().max(2048) });

/**
 * Is this device registered, and for which topics? Asked by the Settings card
 * after it has loaded, never while the Settings page renders: if the table did
 * not exist yet the card would simply show "off", and Settings itself would stay
 * up. Doubles as the "app opened" signal that keeps `lastSeenAt` fresh.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = schema.safeParse(await readSmallJson(request));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const rows = await db
      .update(pushSubscriptions)
      .set({ lastSeenAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint))
      .returning({ topics: pushSubscriptions.topics });

    if (rows.length === 0) return Response.json({ subscribed: false, topics: [] });
    return Response.json({ subscribed: true, topics: cleanTopics(rows[0].topics) });
  } catch {
    // Not set up yet (or the database is struggling): report "not subscribed".
    return Response.json({ subscribed: false, topics: [], unavailable: true });
  }
}
