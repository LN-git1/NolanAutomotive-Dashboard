import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allocateNumber, formatInvoiceNumber, formatJobNumber } from '@/lib/counters';
import * as schema from '@/lib/db/schema';

/**
 * Number FORMATTING is pure and always tested.
 *
 * Number ALLOCATION is a concurrency property, and a mock cannot demonstrate
 * it — the guarantee comes from Postgres row locking, so the test needs a real
 * database. It runs when TEST_DATABASE_URL points at a throwaway Postgres
 * (the local Supabase stack is ideal) and is skipped otherwise, so the suite
 * stays runnable on a laptop with nothing installed.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
 */

describe('invoice number formatting', () => {
  it('zero-pads to four digits and carries the year of issue', () => {
    expect(formatInvoiceNumber(1, 2026)).toBe('NA-2026-0001');
    expect(formatInvoiceNumber(42, 2026)).toBe('NA-2026-0042');
  });

  it('keeps counting past four digits rather than wrapping', () => {
    expect(formatInvoiceNumber(12_345, 2026)).toBe('NA-2026-12345');
  });

  /**
   * The sequence is continuous: crossing into a new year changes the year
   * segment but must NOT reset the counter.
   */
  it('does not reset the sequence at a year boundary', () => {
    expect(formatInvoiceNumber(47, 2026)).toBe('NA-2026-0047');
    expect(formatInvoiceNumber(48, 2027)).toBe('NA-2027-0048');
  });

  it('formats job numbers', () => {
    expect(formatJobNumber(1)).toBe('J-0001');
    expect(formatJobNumber(9_999)).toBe('J-9999');
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('allocateNumber (requires TEST_DATABASE_URL)', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!, { prepare: false, max: 20 });
    db = drizzle(client, { schema });

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS counters (
        key text PRIMARY KEY,
        next_value integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`DELETE FROM counters WHERE key IN ('invoice', 'job')`);
    await db.execute(sql`INSERT INTO counters (key, next_value) VALUES ('invoice', 1), ('job', 1)`);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('hands out sequential values', async () => {
    const first = await db.transaction((tx) => allocateNumber(tx, 'invoice'));
    const second = await db.transaction((tx) => allocateNumber(tx, 'invoice'));

    expect(second).toBe(first + 1);
  });

  /**
   * The property that actually matters: N concurrent allocations must produce N
   * distinct, gap-free values. A read-then-write implementation passes the
   * sequential test above and fails this one.
   */
  it('never issues a duplicate under concurrency', async () => {
    const CONCURRENT = 25;

    const allocated = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        db.transaction((tx) => allocateNumber(tx, 'invoice')),
      ),
    );

    expect(new Set(allocated).size).toBe(CONCURRENT);

    const sorted = [...allocated].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]).toBe(sorted[index - 1]! + 1);
    }
  });

  /**
   * Allocation is transactional: a rollback must return the number to the pool
   * so the sequence never develops a gap. This is why a Postgres SEQUENCE was
   * not used — sequences burn values on rollback by design.
   */
  it('releases the number when its transaction rolls back', async () => {
    const before = await db.transaction((tx) => allocateNumber(tx, 'invoice'));

    await expect(
      db.transaction(async (tx) => {
        await allocateNumber(tx, 'invoice');
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    const after = await db.transaction((tx) => allocateNumber(tx, 'invoice'));

    expect(after).toBe(before + 1);
  });

  it('fails loudly when the counter row is missing', async () => {
    await expect(db.transaction((tx) => allocateNumber(tx, 'job' as const))).resolves.toBeGreaterThan(
      0,
    );

    await db.execute(sql`DELETE FROM counters WHERE key = 'job'`);

    await expect(db.transaction((tx) => allocateNumber(tx, 'job'))).rejects.toThrow(/db:seed/);

    await db.execute(sql`INSERT INTO counters (key, next_value) VALUES ('job', 1)`);
  });
});
