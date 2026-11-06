import 'server-only';

import { eq, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { pushClaims } from '@/lib/db/schema';

/**
 * Take the right to send one particular notification.
 *
 * Inserting the key is the claim: exactly one caller's insert succeeds, so two
 * schedulers firing together (or two supplier charges saved at the same moment)
 * cannot both send. Returns true when this caller won and should send.
 */
export async function claimPush(key: string): Promise<boolean> {
  const won = await db
    .insert(pushClaims)
    .values({ key })
    .onConflictDoNothing()
    .returning({ key: pushClaims.key });
  return won.length > 0;
}

/** Give the claim back after a failed send, so the next caller can try again. */
export async function releasePush(key: string): Promise<void> {
  await db.delete(pushClaims).where(eq(pushClaims.key, key)).catch(() => undefined);
}

/**
 * Forget claims older than 60 days. The "already sent" markers only matter for
 * a day (the morning summary) or a few hours (alerts), so keeping them forever
 * would just grow the table. Best effort: failing to tidy up is never a problem.
 */
export async function prunePushClaims(): Promise<void> {
  await db
    .delete(pushClaims)
    .where(lt(pushClaims.claimedAt, sql`now() - interval '60 days'`))
    .catch(() => undefined);
}
