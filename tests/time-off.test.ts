import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { timeOffDateMap } from '@/lib/db/queries/time-off';
import { timeOffInputSchema } from '@/lib/validation/time-off';
import type { TimeOff } from '@/lib/db/schema';

const entry = (startDate: string, endDate: string, label: string | null = null): TimeOff =>
  ({ id: randomUUID(), startDate, endDate, label, createdAt: new Date() }) as TimeOff;

describe('timeOffInputSchema', () => {
  it('accepts a valid range with a label', () => {
    const result = timeOffInputSchema.safeParse({
      startDate: '2026-08-20',
      endDate: '2026-08-25',
      label: 'Family holiday',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a single day with no label', () => {
    const result = timeOffInputSchema.safeParse({
      startDate: '2026-08-20',
      endDate: '2026-08-20',
      label: '',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.label).toBeNull();
  });

  it('rejects an end date before the start date', () => {
    const result = timeOffInputSchema.safeParse({
      startDate: '2026-08-25',
      endDate: '2026-08-20',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed date', () => {
    const result = timeOffInputSchema.safeParse({ startDate: '20/08/2026', endDate: '2026-08-25' });
    expect(result.success).toBe(false);
  });
});

describe('timeOffDateMap', () => {
  it('expands a multi-day entry to one map entry per day, inclusive of both ends', () => {
    const map = timeOffDateMap([entry('2026-08-20', '2026-08-22', 'Holiday')], '2026-08-01', '2026-08-31');
    expect([...map.keys()].sort()).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(map.get('2026-08-21')).toBe('Holiday');
  });

  it('clamps an entry that spans outside the requested window', () => {
    const map = timeOffDateMap([entry('2026-07-28', '2026-08-03')], '2026-08-01', '2026-08-31');
    expect([...map.keys()].sort()).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('drops an entry that does not overlap the window at all', () => {
    const map = timeOffDateMap([entry('2026-09-01', '2026-09-05')], '2026-08-01', '2026-08-31');
    expect(map.size).toBe(0);
  });

  it('carries a null label through untouched', () => {
    const map = timeOffDateMap([entry('2026-08-10', '2026-08-10', null)], '2026-08-01', '2026-08-31');
    expect(map.get('2026-08-10')).toBeNull();
  });
});

/**
 * `listTimeOffInRange` needs a real overlap test, not just unit coverage of
 * `timeOffDateMap` — the bug this guards against (containment instead of
 * overlap: `start >= from AND end <= to`) would make a holiday that starts
 * before the visible month silently vanish from the query, with
 * `timeOffDateMap` never even getting a chance to be wrong. Requires a real
 * database — see `payments.test.ts` for why these are gated on
 * TEST_DATABASE_URL rather than mocked.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('listTimeOffInRange', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let timeOffTable: (typeof import('@/lib/db/schema'))['timeOff'];
  let listTimeOffInRange: (typeof import('@/lib/db/queries/time-off'))['listTimeOffInRange'];

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ timeOff: timeOffTable } = await import('@/lib/db/schema'));
    ({ listTimeOffInRange } = await import('@/lib/db/queries/time-off'));
  });

  let id: string;

  afterEach(async () => {
    await db.delete(timeOffTable).where(sql`${timeOffTable.id} = ${id}`);
  });

  it('finds an entry that starts before the window and ends inside it', async () => {
    id = randomUUID();
    await db.insert(timeOffTable).values({
      id,
      startDate: '2026-07-28',
      endDate: '2026-08-03',
      label: 'Straddles month start',
    });

    const rows = await listTimeOffInRange('2026-08-01', '2026-08-31');
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it('finds an entry that starts inside the window and ends after it', async () => {
    id = randomUUID();
    await db.insert(timeOffTable).values({
      id,
      startDate: '2026-08-29',
      endDate: '2026-09-04',
      label: 'Straddles month end',
    });

    const rows = await listTimeOffInRange('2026-08-01', '2026-08-31');
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it('excludes an entry entirely outside the window', async () => {
    id = randomUUID();
    await db.insert(timeOffTable).values({
      id,
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      label: 'Next month',
    });

    const rows = await listTimeOffInRange('2026-08-01', '2026-08-31');
    expect(rows.map((r) => r.id)).not.toContain(id);
  });
});
