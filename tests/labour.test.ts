import { describe, expect, it } from 'vitest';

import { buildInvoiceFileName } from '@/lib/invoices/fileName';
import { calcInvoiceTotals, formatHours, sumLabourHours } from '@/lib/money';
import { labourLineSchema } from '@/lib/validation/job';

/**
 * The template's WORK CARRIED OUT table prints HOURS per line and money only in
 * the SUBTOTAL box, so the hours are the thing that has to be exactly right —
 * they are what the customer checks the bill against.
 */
describe('labour hours', () => {
  it('sums the lines in hundredths, without float drift', () => {
    // 0.1 + 0.2 is the classic IEEE-754 trap; in hundredths it is exact.
    const centis = sumLabourHours([
      { description: 'a', hours: '0.1' },
      { description: 'b', hours: '0.2' },
    ]);

    expect(centis).toBe(30);
    expect(formatHours(centis)).toBe('0.3');
  });

  it('adds up the example from the job sheet: 5 + 2 + 3 = 10', () => {
    const lines = [
      { description: 'a', hours: '5' },
      { description: 'b', hours: '2' },
      { description: 'c', hours: '3' },
    ];

    expect(formatHours(sumLabourHours(lines))).toBe('10');

    const totals = calcInvoiceTotals({
      labourLines: lines,
      hourlyRate: '60.00',
      parts: [],
      vatRate: '0',
      vatEnabled: false,
    });

    expect(totals.labourSubtotalCents).toBe(60_000); // 10h x EUR 60
    expect(totals.grandTotalCents).toBe(60_000);
  });

  it('treats a line with no hours as zero time but still keeps the line', () => {
    const lines = [
      { description: 'Timing belt', hours: '4' },
      { description: 'Road tested', hours: '' },
    ];

    expect(formatHours(sumLabourHours(lines))).toBe('4');
  });

  it('renders whole and fractional hours without trailing zeros', () => {
    expect(formatHours(250)).toBe('2.5');
    expect(formatHours(1_000)).toBe('10');
    expect(formatHours(25)).toBe('0.25');
    expect(formatHours(0)).toBe('0');
  });

  it('accepts a blank hours field rather than rejecting the line', () => {
    expect(labourLineSchema.safeParse({ description: 'Road tested', hours: '' }).success).toBe(true);
    expect(labourLineSchema.safeParse({ description: 'Brakes', hours: '2.5' }).success).toBe(true);
    expect(labourLineSchema.safeParse({ description: 'Brakes', hours: 'two' }).success).toBe(false);
  });
});

describe('custom labour total', () => {
  const lines = [{ description: 'Full respray', hours: '12' }];

  it('replaces hours x rate entirely when set', () => {
    const totals = calcInvoiceTotals({
      labourLines: lines,
      hourlyRate: '60.00', // would be EUR 720
      labourTotalOverride: '500.00',
      parts: [],
      vatRate: '0',
      vatEnabled: false,
    });

    expect(totals.labourIsOverridden).toBe(true);
    expect(totals.labourSubtotalCents).toBe(50_000);
    // The hours are untouched: the customer still sees the time on the invoice.
    expect(totals.totalHoursCentis).toBe(1_200);
  });

  it('falls back to hours x rate when blank', () => {
    const totals = calcInvoiceTotals({
      labourLines: lines,
      hourlyRate: '60.00',
      labourTotalOverride: '',
      parts: [],
      vatRate: '0',
      vatEnabled: false,
    });

    expect(totals.labourIsOverridden).toBe(false);
    expect(totals.labourSubtotalCents).toBe(72_000);
  });

  it('is VATed like any other labour figure', () => {
    const totals = calcInvoiceTotals({
      labourLines: lines,
      hourlyRate: '60.00',
      labourTotalOverride: '500.00',
      parts: [],
      vatRate: '23',
      vatEnabled: true,
    });

    expect(totals.labourTaxCents).toBe(11_500); // 23% of 500
    expect(totals.grandTotalCents).toBe(61_500);
  });

  it('treats a zero override as a real figure, not as "unset"', () => {
    const totals = calcInvoiceTotals({
      labourLines: lines,
      hourlyRate: '60.00',
      labourTotalOverride: '0',
      parts: [],
      vatRate: '0',
      vatEnabled: false,
    });

    expect(totals.labourIsOverridden).toBe(true);
    expect(totals.labourSubtotalCents).toBe(0);
  });
});

describe('buildInvoiceFileName', () => {
  it('carries the customer and registration so it is findable in a chat thread', () => {
    expect(buildInvoiceFileName('NA-2026-0004', 'Zach Boyd', '09MN6738')).toBe(
      'NA-2026-0004 - Zach Boyd - 09MN6738.pdf',
    );
  });

  it('strips characters that are illegal in a filename or a header', () => {
    // Accents would be mangled in Content-Disposition; slashes break paths.
    expect(buildInvoiceFileName('NA-2026-0005', 'Séamus Ó Súilleabháin', '181/KE/4429')).toBe(
      'NA-2026-0005 - Samus  Silleabhin - 181KE4429.pdf',
    );
  });

  it('falls back to the number alone when nothing else is known', () => {
    expect(buildInvoiceFileName('NA-2026-0006', null, null)).toBe('NA-2026-0006.pdf');
    expect(buildInvoiceFileName('NA-2026-0007', '', '   ')).toBe('NA-2026-0007.pdf');
  });
});
