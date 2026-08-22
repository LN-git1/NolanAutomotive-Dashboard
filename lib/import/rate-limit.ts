import 'server-only';

import { sql } from 'drizzle-orm';

import type { DbOrTx } from '@/lib/counters';
import type { ImportKind } from '@/lib/db/schema';

/**
 * Atomically admit-or-reject one import parse attempt, logging it only when
 * admitted.
 *
 * A bare `INSERT ... SELECT ... WHERE (count < N)` is NOT safe under
 * Postgres's default READ COMMITTED isolation: concurrent inserts don't see
 * each other's uncommitted rows, so a burst of concurrent calls can all read
 * the same "under the cap" count and all be admitted — verified empirically
 * against a real burst of concurrent calls to blow past the intended cap.
 * `pg_advisory_xact_lock` serializes all admit attempts onto one queue for
 * the duration of the transaction, so each call sees every earlier admission
 * before deciding — the same row-locking principle that makes
 * `allocateNumber` (lib/counters.ts) genuinely safe, adapted for a check
 * with no single row to lock.
 *
 * Global across all three kinds by design for v1 — `kind` is kept only for
 * observability. Thresholds (10/10min, 60/day) are a starting default for a
 * single-owner garage's realistic usage, not a tuned final value.
 */
export async function admitParseAttempt(database: DbOrTx, kind: ImportKind): Promise<boolean> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(823746192)`);

    const result = await tx.execute(sql`
      INSERT INTO import_parse_attempts (kind)
      SELECT ${kind}
       WHERE (SELECT count(*) FROM import_parse_attempts WHERE created_at > now() - interval '10 minutes') < 10
         AND (SELECT count(*) FROM import_parse_attempts WHERE created_at > now() - interval '1 day') < 60
      RETURNING id
    `);

    return (result as unknown as unknown[]).length > 0;
  });
}
