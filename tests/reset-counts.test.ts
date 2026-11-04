import { randomUUID } from 'node:crypto';

import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `getResetCounts` is a single statement on purpose (see its doc comment: more
 * than 8 concurrent queries hangs the Supabase pooler). Collapsing six counts
 * into one must not change a single number, so this compares it with six
 * independent counts. Skipped without TEST_DATABASE_URL.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('getResetCounts', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let s: typeof import('@/lib/db/schema');
  let getResetCounts: (typeof import('@/lib/db/queries/overview'))['getResetCounts'];
  const jobId = randomUUID();

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    s = await import('@/lib/db/schema');
    ({ getResetCounts } = await import('@/lib/db/queries/overview'));
    await db.insert(s.jobs).values({
      id: jobId,
      jobNumber: `TEST-${jobId.slice(0, 8)}`,
      customerName: 'Reset Count Test',
      vehicleRegistration: 'TEST-REG',
      deletedAt: new Date(), // soft-deleted rows must still be counted
    });
  });

  afterAll(async () => {
    await db.delete(s.jobs).where(eq(s.jobs.id, jobId));
  });

  it('matches six independent counts, including soft-deleted jobs', async () => {
    const n = async (table: PgTable) =>
      Number((await db.select({ n: count() }).from(table))[0]?.n ?? 0);

    const result = await getResetCounts();

    expect(result).toEqual({
      jobs: await n(s.jobs),
      invoices: await n(s.invoices),
      attachments: await n(s.jobAttachments),
      suppliers: await n(s.suppliers),
      supplierEntries: await n(s.supplierLedger),
      payments: await n(s.payments),
    });
    expect(result.jobs).toBeGreaterThanOrEqual(1);
  });
});
