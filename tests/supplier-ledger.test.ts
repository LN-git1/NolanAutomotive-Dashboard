import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * `applySupplierPayment` is the transactional core `recordSupplierPayment`
 * (the server action) delegates to after its own session check — it locks the
 * supplier row, recomputes the balance itself rather than trusting any figure
 * from the client, and writes a `payment` entry against the account.
 *
 * Tested directly rather than through the action, for the same reason
 * `tests/payments.test.ts` tests `applyPayment` directly: the action calls
 * `requireSession()`, which needs a real Next.js request context that
 * `cookies()` does not have here. A mock could demonstrate neither the lock
 * nor the real-Postgres arithmetic, so this needs a real database and is
 * skipped when TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
 *
 * The case worth the most here is overpayment. Unlike an invoice, a supplier
 * account CAN be paid past zero — the garage hands a supplier a round sum
 * before that week's dockets are keyed in — and the credit that leaves has to
 * stay on that supplier's own account instead of quietly cancelling out what
 * is owed to someone else.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('applySupplierPayment', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let suppliers: (typeof import('@/lib/db/schema'))['suppliers'];
  let supplierLedger: (typeof import('@/lib/db/schema'))['supplierLedger'];
  let applySupplierPayment: (typeof import(
    '@/lib/db/queries/supplier-ledger'
  ))['applySupplierPayment'];
  let getSupplierBalanceCents: (typeof import(
    '@/lib/db/queries/supplier-ledger'
  ))['getSupplierBalanceCents'];
  let getOwedToSuppliersCents: (typeof import(
    '@/lib/db/queries/overview'
  ))['getOwedToSuppliersCents'];

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ suppliers, supplierLedger } = await import('@/lib/db/schema'));
    ({ applySupplierPayment, getSupplierBalanceCents } = await import(
      '@/lib/db/queries/supplier-ledger'
    ));
    ({ getOwedToSuppliersCents } = await import('@/lib/db/queries/overview'));
  });

  let supplierId: string;

  /** A fresh supplier owed €200.00 for every test, so tests never interact. */
  async function setUp() {
    supplierId = randomUUID();

    await db.insert(suppliers).values({ id: supplierId, name: `Test Supplier ${supplierId}` });
    await db.insert(supplierLedger).values({
      supplierId,
      kind: 'charge',
      amount: '200.00',
      entryDate: '2026-01-15',
      reference: 'TEST-DOCKET',
    });
  }

  afterEach(async () => {
    // The ledger cascades from the supplier, but it is cleared explicitly so a
    // failure mid-test cannot leave entries behind pointing at a live account.
    await db.delete(supplierLedger).where(sql`${supplierLedger.supplierId} = ${supplierId}`);
    await db.delete(suppliers).where(sql`${suppliers.id} = ${supplierId}`);
  });

  it('a part payment comes off the balance and leaves the rest owing', async () => {
    await setUp();

    const result = await applySupplierPayment(supplierId, { amountCents: 5_000 });
    expect(result.ok).toBe(true);

    expect(await getSupplierBalanceCents(supplierId)).toBe(15_000);
  });

  it('"pay the bill off" resolves the amount itself, after an earlier part payment', async () => {
    await setUp();

    await applySupplierPayment(supplierId, { amountCents: 5_000 });
    const result = await applySupplierPayment(supplierId, { payInFull: true });

    expect(result.ok).toBe(true);
    expect(await getSupplierBalanceCents(supplierId)).toBe(0);

    // €150.00 — the balance at the time, not the €200.00 the account started at.
    const entries = await db
      .select()
      .from(supplierLedger)
      .where(sql`${supplierLedger.supplierId} = ${supplierId} AND ${supplierLedger.kind} = 'payment'`);
    expect(entries.map((entry) => entry.amount).sort()).toEqual(['150.00', '50.00']);
  });

  it('a new purchase adds to the balance after it has been settled', async () => {
    await setUp();

    await applySupplierPayment(supplierId, { payInFull: true });
    expect(await getSupplierBalanceCents(supplierId)).toBe(0);

    await db.insert(supplierLedger).values({
      supplierId,
      kind: 'charge',
      amount: '75.50',
      entryDate: '2026-02-01',
    });

    expect(await getSupplierBalanceCents(supplierId)).toBe(7_550);
  });

  it('rejects a zero or negative amount', async () => {
    await setUp();

    expect((await applySupplierPayment(supplierId, { amountCents: 0 })).ok).toBe(false);
    expect((await applySupplierPayment(supplierId, { amountCents: -500 })).ok).toBe(false);
    expect(await getSupplierBalanceCents(supplierId)).toBe(20_000);
  });

  it('refuses "pay the bill off" when nothing is owed', async () => {
    await setUp();
    await applySupplierPayment(supplierId, { payInFull: true });

    const result = await applySupplierPayment(supplierId, { payInFull: true });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing owed/i);
  });

  it('allows paying more than is on the bill, and carries the excess as a credit', async () => {
    await setUp();

    const result = await applySupplierPayment(supplierId, { amountCents: 25_000 });

    expect(result.ok).toBe(true);
    expect(await getSupplierBalanceCents(supplierId)).toBe(-5_000);
  });

  it("a supplier's credit does not cancel out what another supplier is owed", async () => {
    await setUp();

    const otherId = randomUUID();
    await db.insert(suppliers).values({ id: otherId, name: `Test Supplier ${otherId}` });
    await db.insert(supplierLedger).values({
      supplierId: otherId,
      kind: 'charge',
      amount: '100.00',
      entryDate: '2026-01-20',
    });

    const before = await getOwedToSuppliersCents();

    // This account goes €50.00 into credit while the other still owes €100.00.
    await applySupplierPayment(supplierId, { amountCents: 25_000 });

    // The €200.00 leaves the total; the credit must not eat into the other €100.00.
    expect(await getOwedToSuppliersCents()).toBe(before - 20_000);

    await db.delete(supplierLedger).where(sql`${supplierLedger.supplierId} = ${otherId}`);
    await db.delete(suppliers).where(sql`${suppliers.id} = ${otherId}`);
  });
});
