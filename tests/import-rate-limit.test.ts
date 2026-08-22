import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { admitParseAttempt } from '@/lib/import/rate-limit';
import * as schema from '@/lib/db/schema';

/**
 * The property that matters is concurrency-safety and the "rejected attempts
 * aren't logged" guarantee — neither is demonstrable with a mock, so this runs
 * against a real throwaway Postgres, same as `allocateNumber`'s tests.
 *
 *   TEST_DATABASE_URL=postgresql://zach@127.0.0.1:5432/nolan_dashboard pnpm test --run
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('admitParseAttempt (requires TEST_DATABASE_URL)', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!, { prepare: false, max: 20 });
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client?.end();
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM import_parse_attempts`);
  });

  it('admits an attempt and logs exactly one row', async () => {
    const admitted = await admitParseAttempt(db, 'markdown');
    expect(admitted).toBe(true);

    const rows = await db.execute(sql`SELECT * FROM import_parse_attempts`);
    expect((rows as unknown as unknown[]).length).toBe(1);
  });

  it('admits exactly the 10-per-10-minute limit under concurrency, rejects the rest, and logs nothing for a rejection', async () => {
    const CONCURRENT = 15;

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => admitParseAttempt(db, 'screenshot')),
    );

    const admittedCount = results.filter(Boolean).length;
    expect(admittedCount).toBe(10);

    const rows = await db.execute(sql`SELECT * FROM import_parse_attempts`);
    // Rejected attempts are never inserted — logged rows equal admitted count exactly.
    expect((rows as unknown as unknown[]).length).toBe(10);
  });

  it('rejects once the daily cap is hit, independent of the 10-minute window', async () => {
    // Seed 60 attempts spread across the last day but outside the 10-minute
    // window, so only the daily cap is being exercised.
    await db.execute(sql`
      INSERT INTO import_parse_attempts (kind, created_at)
      SELECT 'voice', now() - interval '1 hour' - (n || ' seconds')::interval
      FROM generate_series(1, 60) AS n
    `);

    const admitted = await admitParseAttempt(db, 'markdown');
    expect(admitted).toBe(false);
  });
});
