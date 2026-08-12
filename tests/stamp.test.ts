import { describe, expect, it } from 'vitest';

import { assertPageGeometry } from '@/lib/pdf/coords';
import { SIMPLE_FIELD_KEYS, isRowTemplateKey, isSimpleFieldKey } from '@/lib/pdf/fieldKeys';
import { buildCommentsBlock, buildModelLine, formatIrishDate } from '@/lib/pdf/stamp';

describe('buildModelLine', () => {
  it('appends the registration after the model', () => {
    expect(buildModelLine('Golf 1.6 TDI', '181-KE-4429')).toBe('Golf 1.6 TDI — 181-KE-4429');
  });

  it('falls back gracefully when either part is missing', () => {
    expect(buildModelLine('Golf', null)).toBe('Golf');
    expect(buildModelLine(null, '181-KE-4429')).toBe('181-KE-4429');
    expect(buildModelLine(null, null)).toBe('');
    expect(buildModelLine('  ', '  ')).toBe('');
  });
});

describe('buildCommentsBlock', () => {
  /**
   * The template has no VAT-number blank, so a registered business's number is
   * prefixed into the comments area rather than invented elsewhere on the page.
   */
  it('prefixes the VAT number above the comments', () => {
    expect(buildCommentsBlock('Rear pads at 40%.', 'IE1234567FA')).toBe(
      'VAT No: IE1234567FA\n\nRear pads at 40%.',
    );
  });

  it('omits the VAT line entirely when the business is not registered', () => {
    expect(buildCommentsBlock('Rear pads at 40%.', null)).toBe('Rear pads at 40%.');
  });

  it('renders the VAT line alone when there are no comments', () => {
    expect(buildCommentsBlock(null, 'IE1234567FA')).toBe('VAT No: IE1234567FA');
  });

  it('returns nothing when there is nothing to say', () => {
    expect(buildCommentsBlock(null, null)).toBe('');
    expect(buildCommentsBlock('   ', '  ')).toBe('');
  });
});

describe('formatIrishDate', () => {
  it('formats as DD/MM/YYYY', () => {
    expect(formatIrishDate(new Date(2026, 7, 12))).toBe('12/08/2026');
    expect(formatIrishDate(new Date(2026, 0, 1))).toBe('01/01/2026');
  });
});

describe('assertPageGeometry', () => {
  /**
   * The supplied template is US Letter, not A4. If it is ever re-exported at a
   * different size every coordinate silently shifts, so this must fail loudly.
   */
  it('accepts the template size', () => {
    expect(() =>
      assertPageGeometry({ width: 612, height: 792 }, { width: 612, height: 792 }),
    ).not.toThrow();
  });

  it('tolerates sub-point rounding', () => {
    expect(() =>
      assertPageGeometry({ width: 612.0001, height: 791.9999 }, { width: 612, height: 792 }),
    ).not.toThrow();
  });

  it('rejects an A4 page where Letter is expected', () => {
    expect(() =>
      assertPageGeometry({ width: 595.28, height: 841.89 }, { width: 612, height: 792 }),
    ).toThrow(/page size mismatch/i);
  });
});

describe('field key registry', () => {
  it('recognises every key it publishes', () => {
    for (const key of SIMPLE_FIELD_KEYS) {
      expect(isSimpleFieldKey(key)).toBe(true);
    }
  });

  it('rejects unknown keys so a bad coords file cannot reach the stamper', () => {
    expect(isSimpleFieldKey('customerFavouriteColour')).toBe(false);
    expect(isRowTemplateKey('warrantyTable')).toBe(false);
  });

  it('separates simple fields from row templates', () => {
    expect(isRowTemplateKey('partsTable')).toBe(true);
    expect(isSimpleFieldKey('partsTable')).toBe(false);
  });
});
