import { describe, expect, it } from 'vitest';

import {
  applyRate,
  calcInvoiceTotals,
  formatAmount,
  formatEur,
  formatRate,
  fromCents,
  rateToBasisPoints,
  toCents,
} from '@/lib/money';

describe('toCents', () => {
  it('parses plain decimal strings', () => {
    expect(toCents('123.45')).toBe(12_345);
    expect(toCents('0.05')).toBe(5);
    expect(toCents('7')).toBe(700);
  });

  it('tolerates grouping separators, spaces and the euro sign', () => {
    expect(toCents('1,234.56')).toBe(123_456);
    expect(toCents(' €99.99 ')).toBe(9_999);
  });

  it('pads a single decimal place', () => {
    expect(toCents('1.5')).toBe(150);
  });

  it('rounds half-up on the third decimal', () => {
    expect(toCents('1.005')).toBe(101);
    expect(toCents('1.004')).toBe(100);
  });

  it('treats blank values as zero', () => {
    expect(toCents('')).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });

  it('handles negatives', () => {
    expect(toCents('-12.34')).toBe(-1_234);
  });

  it('rejects nonsense rather than silently producing NaN', () => {
    expect(() => toCents('twelve euro')).toThrow();
  });
});

describe('fromCents / formatting', () => {
  it('round-trips through cents', () => {
    expect(fromCents(12_345)).toBe('123.45');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(0)).toBe('0.00');
  });

  it('groups thousands for display', () => {
    expect(formatAmount(123_456_789)).toBe('1,234,567.89');
    expect(formatEur(123_456)).toBe('€1,234.56');
  });

  it('renders rates without trailing zeroes', () => {
    expect(formatRate(rateToBasisPoints('23.00'))).toBe('23');
    expect(formatRate(rateToBasisPoints('13.5'))).toBe('13.5');
  });
});

describe('applyRate', () => {
  it('applies a percentage expressed in basis points', () => {
    // 23% of €100.00
    expect(applyRate(10_000, 2_300)).toBe(2_300);
  });

  it('returns zero for a zero rate', () => {
    expect(applyRate(99_999, 0)).toBe(0);
  });
});

describe('calcInvoiceTotals', () => {
  const parts = [
    { partName: 'Pads', partNumber: 'BP-1', qty: '1', unitPrice: '68.50' },
    { partName: 'Discs', partNumber: 'BD-2', qty: '2', unitPrice: '54.00' },
  ];

  it('adds labour, parts and VAT the way the template presents them', () => {
    const totals = calcInvoiceTotals({
      labourLines: [{ description: 'Brakes', hours: '3.5' }],
      hourlyRate: '65.00',
      parts,
      vatRate: '23',
      vatEnabled: true,
    });

    expect(totals.labourSubtotalCents).toBe(22_750); // 3.5 x 65.00
    expect(totals.partsSubtotalCents).toBe(17_650); // 68.50 + 108.00

    // VAT is computed per component, then summed.
    expect(totals.labourTaxCents).toBe(5_233);
    expect(totals.partsTaxCents).toBe(4_060);
    expect(totals.totalTaxCents).toBe(9_293);

    // TOTAL = services + parts + tax
    expect(totals.grandTotalCents).toBe(22_750 + 17_650 + 9_293);
  });

  it('computes each part line amount as qty x unit price', () => {
    const totals = calcInvoiceTotals({
      labourLines: [],
      hourlyRate: '0',
      parts,
      vatRate: '23',
      vatEnabled: true,
    });

    expect(totals.parts[0]?.amount).toBe('68.50');
    expect(totals.parts[1]?.amount).toBe('108.00');
  });

  it('supports fractional quantities without float drift', () => {
    const totals = calcInvoiceTotals({
      labourLines: [],
      hourlyRate: '0',
      parts: [{ partName: 'Oil', partNumber: 'O-1', qty: '4.5', unitPrice: '9.20' }],
      vatRate: '0',
      vatEnabled: false,
    });

    expect(totals.parts[0]?.amount).toBe('41.40');
    expect(totals.partsSubtotalCents).toBe(4_140);
  });

  it('forces the rate and every tax amount to zero when VAT is disabled', () => {
    const totals = calcInvoiceTotals({
      labourLines: [{ description: 'Service', hours: '10' }],
      hourlyRate: '50',
      parts,
      // A rate is still configured; being unregistered must override it.
      vatRate: '23',
      vatEnabled: false,
    });

    expect(totals.vatBasisPoints).toBe(0);
    expect(totals.labourTaxCents).toBe(0);
    expect(totals.partsTaxCents).toBe(0);
    expect(totals.totalTaxCents).toBe(0);
    expect(totals.grandTotalCents).toBe(totals.labourSubtotalCents + totals.partsSubtotalCents);
  });

  it('handles an invoice with no parts and no labour', () => {
    const totals = calcInvoiceTotals({
      labourLines: [],
      hourlyRate: '',
      parts: [],
      vatRate: '23',
      vatEnabled: true,
    });

    expect(totals.grandTotalCents).toBe(0);
    expect(totals.totalTaxCents).toBe(0);
  });
});
