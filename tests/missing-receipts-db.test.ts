import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { formatRecordedAt } from '@/lib/format-recorded';

describe('formatRecordedAt: when an entry was typed in, in Irish time', () => {
  it('shows the Dublin clock, not the server clock, in summer (one hour ahead of UTC)', () => {
    // 20:30 UTC on 14 July is 21:30 in Dublin.
    expect(formatRecordedAt(new Date('2026-07-14T20:30:00Z'), '24h')).toBe('14/07/2026 21:30');
    expect(formatRecordedAt(new Date('2026-07-14T20:30:00Z'), '12h')).toBe('14/07/2026 9:30pm');
  });

  it('matches UTC in winter', () => {
    expect(formatRecordedAt(new Date('2026-01-14T20:30:00Z'), '24h')).toBe('14/01/2026 20:30');
  });

  it('puts an entry made just after midnight in summer on the next Dublin day', () => {
    // 23:30 UTC on 14 July is 00:30 on 15 July in Dublin.
    expect(formatRecordedAt(new Date('2026-07-14T23:30:00Z'), '24h')).toBe('15/07/2026 00:30');
    expect(formatRecordedAt(new Date('2026-07-14T23:30:00Z'), '12h')).toBe('15/07/2026 12:30am');
  });
});

/**
 * Real Postgres: the list, the attach action, and the accountant's CSV. Skipped
 * without TEST_DATABASE_URL, like the other database tests.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () => undefined,
  requireApiSession: async () => null,
  hasValidSession: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@/lib/push/after', () => ({ runAfterResponse: () => undefined }));
vi.mock('@/lib/push/alert', () => ({ alertAfterResponse: () => undefined }));

describe.skipIf(!TEST_DATABASE_URL)('missing receipts (real database)', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let s: typeof import('@/lib/db/schema');
  let q: typeof import('@/lib/db/queries/missing-receipts');
  let actions: typeof import('@/lib/actions/suppliers');
  let exportGet: (request: Request) => Promise<Response>;

  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const ids = { noReceipt: '', hasReceipt: '', payment: '', older: '', other: '' };

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    s = await import('@/lib/db/schema');
    q = await import('@/lib/db/queries/missing-receipts');
    actions = await import('@/lib/actions/suppliers');
    ({ GET: exportGet } = await import('@/app/api/export/supplier-bills/route'));

    await db.insert(s.suppliers).values([
      { id: supplierA, name: 'Receipt Test Alpha Parts' },
      { id: supplierB, name: 'Receipt Test Beta Tyres' },
    ]);

    const insert = async (values: Record<string, unknown>) => {
      const [row] = await db
        .insert(s.supplierLedger)
        .values(values as typeof s.supplierLedger.$inferInsert)
        .returning({ id: s.supplierLedger.id });
      return row.id;
    };

    ids.older = await insert({ supplierId: supplierA, kind: 'charge', amount: '12.34', entryDate: '2031-04-01', reference: 'OLD-1' });
    ids.noReceipt = await insert({ supplierId: supplierA, kind: 'charge', amount: '250.00', entryDate: '2031-04-10', reference: 'INV-77', notes: 'brake pads' });
    ids.hasReceipt = await insert({
      supplierId: supplierA,
      kind: 'charge',
      amount: '99.99',
      entryDate: '2031-04-11',
      attachmentStoragePath: `suppliers/${supplierA}/existing-receipt.pdf`,
    });
    ids.payment = await insert({ supplierId: supplierA, kind: 'payment', amount: '50.00', entryDate: '2031-04-12' });
    ids.other = await insert({ supplierId: supplierB, kind: 'charge', amount: '400.00', entryDate: '2031-04-13' });
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, [supplierA, supplierB]));
  });

  const mine = <T extends { supplierId: string }>(rows: T[]): T[] =>
    rows.filter((r) => r.supplierId === supplierA || r.supplierId === supplierB);

  it('lists only purchases without a receipt: not payments, not purchases that have one', async () => {
    const rows = mine(await q.listChargesMissingReceipts());
    const found = rows.map((r) => r.id);

    expect(found).toContain(ids.noReceipt);
    expect(found).toContain(ids.older);
    expect(found).toContain(ids.other);
    expect(found).not.toContain(ids.hasReceipt);
    expect(found).not.toContain(ids.payment);
  });

  it('carries everything the accountant needs: supplier, exact amount, purchase date, when it was entered', async () => {
    const row = mine(await q.listChargesMissingReceipts()).find((r) => r.id === ids.noReceipt)!;

    expect(row.supplierName).toBe('Receipt Test Alpha Parts');
    expect(row.amount).toBe('250.00');
    expect(row.entryDate).toBe('2031-04-10');
    expect(row.reference).toBe('INV-77');
    expect(row.notes).toBe('brake pads');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(Number.isNaN(row.createdAt.getTime())).toBe(false);
  });

  it('is ordered newest purchase first', async () => {
    const order = mine(await q.listChargesMissingReceipts()).map((r) => r.id);
    expect(order.indexOf(ids.other)).toBeLessThan(order.indexOf(ids.noReceipt));
    expect(order.indexOf(ids.noReceipt)).toBeLessThan(order.indexOf(ids.older));
  });

  it('counts them', async () => {
    expect(await q.countChargesMissingReceipts()).toBeGreaterThanOrEqual(3);
  });

  it('refuses to attach a receipt from another supplier’s folder or a path that climbs out of it', async () => {
    for (const bad of [
      `suppliers/${supplierB}/file.pdf`,
      `jobs/${randomUUID()}/file.pdf`,
      `suppliers/${supplierA}/../${supplierB}/file.pdf`,
      '',
      'file.pdf',
    ]) {
      const result = await actions.attachSupplierReceipt(ids.noReceipt, bad);
      expect(result.ok, bad).toBe(false);
    }
    const [row] = await db.select().from(s.supplierLedger).where(eq(s.supplierLedger.id, ids.noReceipt));
    expect(row.attachmentStoragePath).toBeNull();
  });

  it('refuses a payment, an unknown entry and a bad id', async () => {
    expect((await actions.attachSupplierReceipt(ids.payment, `suppliers/${supplierA}/x.pdf`)).ok).toBe(false);
    expect((await actions.attachSupplierReceipt(randomUUID(), `suppliers/${supplierA}/x.pdf`)).ok).toBe(false);
    expect((await actions.attachSupplierReceipt('not-a-uuid', `suppliers/${supplierA}/x.pdf`)).ok).toBe(false);
  });

  it('never replaces a receipt that is already there', async () => {
    const result = await actions.attachSupplierReceipt(ids.hasReceipt, `suppliers/${supplierA}/replacement.pdf`);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already has a receipt/);

    const [row] = await db.select().from(s.supplierLedger).where(eq(s.supplierLedger.id, ids.hasReceipt));
    expect(row.attachmentStoragePath).toBe(`suppliers/${supplierA}/existing-receipt.pdf`);
  });

  it('the accountant’s CSV: default export gains a Receipt column and keeps the old ones in place', async () => {
    const text = await (await exportGet(new Request('https://x.test/api/export/supplier-bills'))).text();
    const header = text.replace(/^﻿/, '').split(/\r?\n/)[0];

    // Every cell is quoted in this export; the order and names are what matter.
    expect(header.replace(/"/g, '')).toBe('Supplier,Date,Type,Reference,Added to bill,Paid off,Notes,Recorded,Receipt');

    const lines = text.split(/\r?\n/);
    const noReceiptLine = lines.find((l) => l.includes('INV-77'))!;
    const hasReceiptLine = lines.find((l) => l.includes('99.99'))!;
    const paymentLine = lines.find((l) => l.includes('Receipt Test Alpha Parts') && l.includes('"Paid off"') && l.includes('50.00'))!;
    expect(noReceiptLine.endsWith('"Missing"')).toBe(true);
    expect(hasReceiptLine.endsWith('"On file"')).toBe(true);
    expect(paymentLine.endsWith(',""')).toBe(true); // blank receipt cell for a payment
  });

  it('?missing=1 exports only purchases without a receipt, under its own file name', async () => {
    const response = await exportGet(new Request('https://x.test/api/export/supplier-bills?missing=1'));
    const text = await response.text();

    expect(response.headers.get('content-disposition')).toMatch(/nolan-supplier-missing-receipts-\d{4}-\d{2}-\d{2}\.csv/);
    expect(text).toContain('INV-77');
    expect(text).toContain('OLD-1');
    expect(text).not.toContain('99.99'); // has a receipt
    expect(text).not.toContain(',50.00'); // a payment
    for (const line of text.split(/\r?\n/).slice(1).filter(Boolean)) {
      expect(line.endsWith('"Missing"'), line).toBe(true);
    }
  });

  it('attaching a receipt takes the purchase off the list', async () => {
    const path = `suppliers/${supplierA}/${randomUUID()}-receipt.pdf`;
    const result = await actions.attachSupplierReceipt(ids.noReceipt, path);
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(s.supplierLedger).where(eq(s.supplierLedger.id, ids.noReceipt));
    expect(row.attachmentStoragePath).toBe(path);
    expect(mine(await q.listChargesMissingReceipts()).map((r) => r.id)).not.toContain(ids.noReceipt);

    const text = await (await exportGet(new Request('https://x.test/api/export/supplier-bills?missing=1'))).text();
    expect(text).not.toContain('INV-77');
  });

  it('two people attaching to the same purchase at the same moment: one wins, nobody overwrites anybody', async () => {
    const first = `suppliers/${supplierB}/${randomUUID()}-first.pdf`;
    const second = `suppliers/${supplierB}/${randomUUID()}-second.pdf`;

    const results = await Promise.all([
      actions.attachSupplierReceipt(ids.other, first),
      actions.attachSupplierReceipt(ids.other, second),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await db.select().from(s.supplierLedger).where(eq(s.supplierLedger.id, ids.other));
    expect([first, second]).toContain(row.attachmentStoragePath);
  });
});
