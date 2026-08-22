import 'server-only';

import { sql } from 'drizzle-orm';

import type { DbOrTx } from '@/lib/counters';
import type { ImportKind } from '@/lib/db/schema';

/**
 * Atomically admit-or-reject one import parse attempt, logging it only when
 * admitted. `INSERT ... SELECT ... WHERE (...)` means the whole check-and-log
 * happens in one round trip: if either window is already at its cap, the
 * SELECT yields no rows, nothing is inserted, and RETURNING is empty — so a
 * client retrying past the limit can never dig itself deeper by triggering
 * another log entry on the rejected call.
 *
 * Global across all three kinds by design for v1 — `kind` is kept only for
 * observability. Thresholds (10/10min, 60/day) are a starting default for a
 * single-owner garage's realistic usage, not a tuned final value.
 */
export async function admitParseAttempt(database: DbOrTx, kind: ImportKind): Promise<boolean> {
  const result = await database.execute(sql`
    INSERT INTO import_parse_attempts (kind)
    SELECT ${kind}
     WHERE (SELECT count(*) FROM import_parse_attempts WHERE created_at > now() - interval '10 minutes') < 10
       AND (SELECT count(*) FROM import_parse_attempts WHERE created_at > now() - interval '1 day') < 60
    RETURNING id
  `);

  return (result as unknown as unknown[]).length > 0;
}
