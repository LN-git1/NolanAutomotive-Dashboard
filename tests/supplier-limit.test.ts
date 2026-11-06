import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { supplierLevel } from '@/lib/push/supplier-level';

describe('supplierLevel: where a bill stands against its limit', () => {
  const LIMIT = 100_000; // €1,000.00

  it('is below until the bill reaches 80% of the limit', () => {
    expect(supplierLevel(0, LIMIT)).toBe('below');
    expect(supplierLevel(79_999, LIMIT)).toBe('below');
  });

  it('warns from exactly 80% up to just under the limit', () => {
    expect(supplierLevel(80_000, LIMIT)).toBe('warn');
    expect(supplierLevel(99_999, LIMIT)).toBe('warn');
  });

  it('is full at exactly the limit and above it', () => {
    expect(supplierLevel(100_000, LIMIT)).toBe('full');
    expect(supplierLevel(250_000, LIMIT)).toBe('full');
  });

  it('treats a credit with the supplier as below', () => {
    expect(supplierLevel(-5_000, LIMIT)).toBe('below');
  });

  it('never fires without a usable limit', () => {
    expect(supplierLevel(999_999, 0)).toBe('below');
    expect(supplierLevel(999_999, -1)).toBe('below');
    expect(supplierLevel(999_999, Number.NaN)).toBe('below');
  });

  it('is exact on awkward limits, with no rounding either way', () => {
    // 80% of 333 cents is 266.4: 266 is below, 267 is at or over.
    expect(supplierLevel(266, 333)).toBe('below');
    expect(supplierLevel(267, 333)).toBe('warn');
  });
});

/**
 * The once-only behaviour against a real Postgres: each alert fires once, stays
 * quiet while the bill sits in the same band, fires again after the bill has
 * dropped below its line, and two checks racing each other send one alert, not
 * two. Skipped without TEST_DATABASE_URL, like the other database tests.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const sendPush = vi.fn();
vi.mock('@/lib/push/send', () => ({ sendPush }));

describe.skipIf(!TEST_DATABASE_URL)('supplier limit alerts (real database)', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let s: typeof import('@/lib/db/schema');
  let evaluate: (typeof import('@/lib/push/supplier-limits'))['evaluateSupplierLimit'];
  let lookup: (typeof import('@/lib/push/supplier-limits'))['getSupplierLimit'];

  const supplierId = randomUUID();
  const entryIds: string[] = [];

  /** Put the bill at exactly `euro` by replacing all entries with one charge. */
  async function setBill(euro: number) {
    await db.delete(s.supplierLedger).where(eq(s.supplierLedger.supplierId, supplierId));
    if (euro !== 0) {
      const [row] = await db
        .insert(s.supplierLedger)
        .values({ supplierId, kind: 'charge', amount: euro.toFixed(2), entryDate: '2031-03-01' })
        .returning({ id: s.supplierLedger.id });
      entryIds.push(row.id);
    }
  }

  async function setLimit(euro: number) {
    await db
      .insert(s.supplierLimits)
      .values({ supplierId, limitCents: euro * 100 })
      .onConflictDoUpdate({
        target: s.supplierLimits.supplierId,
        set: { limitCents: euro * 100, alert80At: null, alert100At: null },
      });
  }

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    s = await import('@/lib/db/schema');
    ({ evaluateSupplierLimit: evaluate, getSupplierLimit: lookup } = await import('@/lib/push/supplier-limits'));
    await db.insert(s.suppliers).values({ id: supplierId, name: 'Push Test Parts Ltd' });
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId)); // cascades the ledger and limit
  });

  beforeEach(async () => {
    sendPush.mockReset().mockResolvedValue({ configured: true, attempted: 1, delivered: 1, removed: 0, failed: 0 });
    await db.delete(s.supplierLimits).where(eq(s.supplierLimits.supplierId, supplierId));
    await setBill(0);
  });

  const sent = () => sendPush.mock.calls.map((call) => call[1].title as string);

  it('does nothing when there is no limit', async () => {
    await setBill(5000);
    await evaluate(supplierId);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('does nothing while the bill is under 80%', async () => {
    await setLimit(1000);
    await setBill(799);
    await evaluate(supplierId);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('sends the 80% alert once, however many times it is checked', async () => {
    await setLimit(1000);
    await setBill(850);
    await evaluate(supplierId);
    await evaluate(supplierId);
    await evaluate(supplierId);

    expect(sent()).toEqual(['Supplier balance at 80%']);
    expect(sendPush.mock.calls[0][0]).toBe('supplier');
    expect(sendPush.mock.calls[0][1].body).toContain('Push Test Parts Ltd');
    expect(sendPush.mock.calls[0][1].body).toContain('€850.00');
  });

  it('then sends the limit-reached alert once, as a second notification', async () => {
    await setLimit(1000);
    await setBill(850);
    await evaluate(supplierId);
    await setBill(1000);
    await evaluate(supplierId);
    await evaluate(supplierId);

    expect(sent()).toEqual(['Supplier balance at 80%', 'Supplier limit reached']);
  });

  it('jumping straight past the limit sends only the limit alert, not both', async () => {
    await setLimit(1000);
    await setBill(1200);
    await evaluate(supplierId);

    expect(sent()).toEqual(['Supplier limit reached']);

    await setBill(900); // back under the limit but still over 80%: the 80% alert was effectively already given
    await evaluate(supplierId);
    expect(sent()).toEqual(['Supplier limit reached']);
  });

  it('alerts again after the bill has been paid down below 80% and climbs back', async () => {
    await setLimit(1000);
    await setBill(850);
    await evaluate(supplierId);
    await setBill(300); // paid down
    await evaluate(supplierId); // clears the markers
    await setBill(900); // climbs again
    await evaluate(supplierId);

    expect(sent()).toEqual(['Supplier balance at 80%', 'Supplier balance at 80%']);
  });

  it('after dropping from the limit back into the 80% band, a return to the limit alerts again', async () => {
    await setLimit(1000);
    await setBill(1100);
    await evaluate(supplierId);
    await setBill(900); // paid some off
    await evaluate(supplierId);
    await setBill(1100); // over again
    await evaluate(supplierId);

    expect(sent()).toEqual(['Supplier limit reached', 'Supplier limit reached']);
  });

  it('two checks at the same moment send one alert, not two', async () => {
    await setLimit(1000);
    await setBill(1000);
    await Promise.all([evaluate(supplierId), evaluate(supplierId), evaluate(supplierId)]);

    expect(sent()).toEqual(['Supplier limit reached']);
  });

  it('reports the limit, and reports "unavailable" instead of throwing when the table cannot be read', async () => {
    await setLimit(1000);
    expect(await lookup(supplierId)).toEqual({ available: true, limitCents: 100_000 });

    await db.delete(s.supplierLimits).where(eq(s.supplierLimits.supplierId, supplierId));
    expect(await lookup(supplierId)).toEqual({ available: true, limitCents: null });
  });
});

describe('getSupplierLimit when the table is missing', () => {
  it('says unavailable rather than failing the page', async () => {
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                throw new Error('relation "supplier_limits" does not exist');
              },
            }),
          }),
        }),
      },
    }));
    const { getSupplierLimit } = await import('@/lib/push/supplier-limits');
    expect(await getSupplierLimit(randomUUID())).toEqual({ available: false });
    vi.doUnmock('@/lib/db');
  });
});
