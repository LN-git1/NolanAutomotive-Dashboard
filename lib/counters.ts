import 'server-only';

import { sql } from 'drizzle-orm';

import type { Database } from './db';

/** Either the base client or an open transaction — allocation requires the latter. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type CounterKey = 'invoice' | 'job';

/**
 * Atomically consume the next value for a counter.
 *
 * Implemented as a single `UPDATE ... RETURNING`, which takes a row-level
 * exclusive lock for the duration of the statement. Concurrent callers
 * therefore serialise on that row and each receives a distinct value — there is
 * no read-then-write window in which two callers could observe the same number.
 *
 * MUST be called inside the same transaction as the INSERT it is numbering. If
 * that insert rolls back, the allocation rolls back with it and no value is
 * burned. This is precisely why a Postgres SEQUENCE was not used: sequences are
 * non-transactional and leave permanent gaps on rollback, which is unacceptable
 * for an invoice run that Revenue may inspect.
 */
export async function allocateNumber(tx: DbOrTx, key: CounterKey): Promise<number> {
  const result = await tx.execute<{ allocated: number }>(sql`
    UPDATE counters
       SET next_value = next_value + 1,
           updated_at = now()
     WHERE key = ${key}
    RETURNING next_value - 1 AS allocated
  `);

  const rows = result as unknown as { allocated: number | string }[];
  const raw = rows[0]?.allocated;

  if (raw === undefined) {
    throw new Error(
      `Counter row "${key}" is missing. Run \`pnpm db:seed\` to initialise the counters table.`,
    );
  }

  const allocated = Number(raw);
  if (!Number.isInteger(allocated) || allocated < 1) {
    throw new Error(`Counter "${key}" returned an invalid value: ${String(raw)}`);
  }

  return allocated;
}

/**
 * Read what the next value WOULD be without consuming it.
 *
 * Used only by the Settings page, to display the invoice number that will be
 * used next. Not authoritative — if another invoice is generated in the
 * meantime, `allocateNumber` is what actually consumes a value, so a
 * concurrent allocation between this read and that one is harmless; the
 * Settings card just shows a stale number until the page next reloads.
 */
export async function peekNextNumber(tx: DbOrTx, key: CounterKey): Promise<number> {
  const result = await tx.execute<{ next_value: number }>(sql`
    SELECT next_value FROM counters WHERE key = ${key}
  `);

  const rows = result as unknown as { next_value: number | string }[];
  const raw = rows[0]?.next_value;

  if (raw === undefined) {
    throw new Error(
      `Counter row "${key}" is missing. Run \`pnpm db:seed\` to initialise the counters table.`,
    );
  }

  return Number(raw);
}

/**
 * Invoice numbers are `NA-YYYY-NNNN`. The year segment reflects the year of
 * issue, but the numeric segment is CONTINUOUS and never resets in January —
 * the sequence must contain no gaps and no reuse across its whole lifetime.
 */
export function formatInvoiceNumber(value: number, year: number): string {
  return `NA-${year}-${String(value).padStart(4, '0')}`;
}

/** Job numbers are `J-NNNN`, continuous, never reused even after a soft delete. */
export function formatJobNumber(value: number): string {
  return `J-${String(value).padStart(4, '0')}`;
}
