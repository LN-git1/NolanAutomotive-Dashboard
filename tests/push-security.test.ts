import { describe, expect, it } from 'vitest';

import { readSmallJson } from '@/lib/push/body';
import { isOwnSupplierReceiptPath } from '@/lib/storage/receipt-path';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('isOwnSupplierReceiptPath: a receipt can only be that supplier’s own file', () => {
  it('accepts the shape the app mints for a supplier receipt, including odd but harmless file names', () => {
    for (const name of ['3f2a-receipt.pdf', 'photo.jpg', 'invoice..pdf', 'my receipt (1).png', 'a.b.c.d']) {
      expect(isOwnSupplierReceiptPath(`suppliers/${A}/${name}`, A), name).toBe(true);
    }
  });

  it('refuses another supplier’s folder, other kinds of file, and anything not under suppliers/', () => {
    for (const path of [
      `suppliers/${B}/x.pdf`,
      `jobs/${A}/x.pdf`,
      `expenses/${A}/x.pdf`,
      `invoices/${A}.pdf`,
      `x/suppliers/${A}/x.pdf`,
      `/suppliers/${A}/x.pdf`,
      `suppliers/${A}`,
      '',
    ]) {
      expect(isOwnSupplierReceiptPath(path, A), path).toBe(false);
    }
  });

  it('refuses a path that climbs out of the folder, however it is written', () => {
    for (const path of [
      `suppliers/${A}/../${B}/x.pdf`,
      `suppliers/${A}/../../jobs/x.pdf`,
      `suppliers/${A}/./x.pdf`,
      `suppliers/${A}//x.pdf`,
      `suppliers/${A}/x/../y.pdf`,
      `suppliers/${A}/..`,
      `suppliers/${A}/..\\other`,
    ]) {
      expect(isOwnSupplierReceiptPath(path, A), path).toBe(false);
    }
  });

  it('refuses control characters, a missing file name and an absurdly long one', () => {
    expect(isOwnSupplierReceiptPath(`suppliers/${A}/a\u0000b.pdf`, A)).toBe(false);
    expect(isOwnSupplierReceiptPath(`suppliers/${A}/a\nb.pdf`, A)).toBe(false);
    expect(isOwnSupplierReceiptPath(`suppliers/${A}/`, A)).toBe(false);
    expect(isOwnSupplierReceiptPath(`suppliers/${A}/${'x'.repeat(401)}`, A)).toBe(false);
    expect(isOwnSupplierReceiptPath(`suppliers/${A}/${'x'.repeat(400)}`, A)).toBe(true);
  });
});

describe('readSmallJson: the push routes take a few short fields, never a big body', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://x.test/api/push/subscribe', { method: 'POST', body, headers });

  it('reads a normal body', async () => {
    expect(await readSmallJson(post('{"endpoint":"https://web.push.apple.com/x","topics":["morning"]}'))).toEqual({
      endpoint: 'https://web.push.apple.com/x',
      topics: ['morning'],
    });
  });

  it('returns null for a body that is too big, by its declared length or by its real length', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(20_000) });
    expect(await readSmallJson(post(big, { 'content-length': String(big.length) }))).toBeNull();
    expect(await readSmallJson(post(big))).toBeNull(); // no header: the text itself is measured
    expect(await readSmallJson(post('{"a":1}', { 'content-length': '999999' }))).toBeNull(); // a lying header
  });

  it('honours a different limit', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(100) });
    expect(await readSmallJson(post(body), 50)).toBeNull();
    expect(await readSmallJson(post(body), 500)).not.toBeNull();
  });

  it('returns null for an empty body or one that is not JSON', async () => {
    expect(await readSmallJson(post(''))).toBeNull();
    expect(await readSmallJson(post('not json'))).toBeNull();
    expect(await readSmallJson(post('{"unterminated":'))).toBeNull();
  });
});
