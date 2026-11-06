import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real supplier actions against a real Postgres: every action that can move
 * a balance must trigger the limit check, setting a limit must validate and
 * reset the alert markers, and a failing check must never fail the action.
 * Skipped without TEST_DATABASE_URL, like the other database tests.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const evaluateSupplierLimit = vi.fn();

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () => undefined,
  requireApiSession: async () => null,
  hasValidSession: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@/lib/push/supplier-limits', () => ({ evaluateSupplierLimit }));

function chargeForm(supplierId: string, amount: string) {
  const form = new FormData();
  form.set('supplierId', supplierId);
  form.set('amount', amount);
  form.set('entryDate', '2031-03-01');
  return form;
}

describe.skipIf(!TEST_DATABASE_URL)('supplier actions and the limit check (real database)', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let s: typeof import('@/lib/db/schema');
  let actions: typeof import('@/lib/actions/suppliers');

  const supplierId = randomUUID();

  const checks = () => evaluateSupplierLimit.mock.calls.map((call) => call[0]);
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    s = await import('@/lib/db/schema');
    actions = await import('@/lib/actions/suppliers');
    await db.insert(s.suppliers).values({ id: supplierId, name: 'Push Test Action Supplier' });
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  });

  beforeEach(async () => {
    evaluateSupplierLimit.mockReset().mockResolvedValue(undefined);
    await db.delete(s.supplierLedger).where(eq(s.supplierLedger.supplierId, supplierId));
    await db.delete(s.supplierLimits).where(eq(s.supplierLimits.supplierId, supplierId));
  });

  it('a purchase triggers the check', async () => {
    const result = await actions.addSupplierCharge(chargeForm(supplierId, '120.00'));
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(checks()).toEqual([supplierId]));
  });

  it('a payment triggers the check', async () => {
    await actions.addSupplierCharge(chargeForm(supplierId, '200.00'));
    await vi.waitFor(() => expect(checks()).toHaveLength(1));
    evaluateSupplierLimit.mockClear();

    const result = await actions.recordSupplierPayment(supplierId, { amount: '50.00' });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(checks()).toEqual([supplierId]));
  });

  it('removing an entry triggers the check', async () => {
    await actions.addSupplierCharge(chargeForm(supplierId, '75.00'));
    await vi.waitFor(() => expect(checks()).toHaveLength(1));
    evaluateSupplierLimit.mockClear();

    const [entry] = await db.select().from(s.supplierLedger).where(eq(s.supplierLedger.supplierId, supplierId));
    const result = await actions.deleteSupplierEntry(entry.id);
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(checks()).toEqual([supplierId]));
  });

  it('a failed payment does not trigger the check', async () => {
    const result = await actions.recordSupplierPayment(supplierId, { amount: 'not a number' });
    expect(result.ok).toBe(false);
    await settle();
    expect(checks()).toEqual([]);
  });

  it('a failing check never fails the purchase or the payment', async () => {
    evaluateSupplierLimit.mockRejectedValue(new Error('push exploded'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await actions.addSupplierCharge(chargeForm(supplierId, '100.00'))).ok).toBe(true);
    expect((await actions.recordSupplierPayment(supplierId, { amount: '10.00' })).ok).toBe(true);

    const entries = await db.select().from(s.supplierLedger).where(eq(s.supplierLedger.supplierId, supplierId));
    expect(entries).toHaveLength(2);
  });

  it('setting a limit stores it in cents, resets the alert markers and runs the check', async () => {
    await db.insert(s.supplierLimits).values({
      supplierId,
      limitCents: 50_000,
      alert80At: new Date(),
      alert100At: new Date(),
    });

    const result = await actions.setSupplierLimit(supplierId, '1234.50');
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(s.supplierLimits).where(eq(s.supplierLimits.supplierId, supplierId));
    expect(row.limitCents).toBe(123_450);
    expect(row.alert80At).toBeNull();
    expect(row.alert100At).toBeNull();
    await vi.waitFor(() => expect(checks()).toEqual([supplierId]));
  });

  it('refuses a limit that is zero, negative, text or absurdly large, and changes nothing', async () => {
    for (const bad of ['0', '-5', 'lots', '', '12345678', '1e5']) {
      const result = await actions.setSupplierLimit(supplierId, bad);
      expect(result.ok, bad).toBe(false);
    }
    const rows = await db.select().from(s.supplierLimits).where(eq(s.supplierLimits.supplierId, supplierId));
    expect(rows).toHaveLength(0);
  });

  it('refuses a limit for a supplier that does not exist', async () => {
    const result = await actions.setSupplierLimit(randomUUID(), '500');
    expect(result.ok).toBe(false);
  });

  it('removing a limit deletes it', async () => {
    await actions.setSupplierLimit(supplierId, '500');
    const result = await actions.clearSupplierLimit(supplierId);
    expect(result.ok).toBe(true);

    const rows = await db.select().from(s.supplierLimits).where(eq(s.supplierLimits.supplierId, supplierId));
    expect(rows).toHaveLength(0);
  });

  it('deleting the supplier removes its limit with it', async () => {
    const other = randomUUID();
    await db.insert(s.suppliers).values({ id: other, name: 'Push Test Doomed Supplier' });
    await actions.setSupplierLimit(other, '500');

    const result = await actions.deleteSupplier(other);
    expect(result.ok).toBe(true);

    const rows = await db.select().from(s.supplierLimits).where(eq(s.supplierLimits.supplierId, other));
    expect(rows).toHaveLength(0);
  });
});
