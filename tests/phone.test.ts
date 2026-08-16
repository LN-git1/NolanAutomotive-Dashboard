import { describe, expect, it } from 'vitest';

import { hasWhatsAppNumber, toWhatsAppNumber } from '@/lib/phone';

/**
 * These cases are the shapes real customer numbers arrive in. Getting any of
 * them wrong opens WhatsApp on a contact picker — or worse, the wrong contact —
 * which is exactly the bug this replaced.
 */
describe('toWhatsAppNumber', () => {
  it('converts an Irish national number, replacing the trunk 0', () => {
    expect(toWhatsAppNumber('087 430 3785')).toBe('353874303785');
    expect(toWhatsAppNumber('0874303785')).toBe('353874303785');
  });

  it('keeps an already-international number as it is', () => {
    expect(toWhatsAppNumber('+353 87 430 3785')).toBe('353874303785');
    expect(toWhatsAppNumber('353874303785')).toBe('353874303785');
  });

  it('handles the 00 international prefix', () => {
    expect(toWhatsAppNumber('00353874303785')).toBe('353874303785');
  });

  it('strips punctuation and spacing', () => {
    expect(toWhatsAppNumber('(087) 430-3785')).toBe('353874303785');
    expect(toWhatsAppNumber(' 087-430 3785 ')).toBe('353874303785');
  });

  it('does not double the country code on a number that already has it', () => {
    expect(toWhatsAppNumber('353874303785')).toBe('353874303785');
    expect(toWhatsAppNumber('353874303785')).not.toContain('353353');
  });

  it('supports a non-Irish country code when asked', () => {
    expect(toWhatsAppNumber('07700 900123', '44')).toBe('447700900123');
  });

  it('returns null for anything unusable, so the caller can fall back', () => {
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber(undefined)).toBeNull();
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber('   ')).toBeNull();
    expect(toWhatsAppNumber('n/a')).toBeNull();
    // Too short to be a real international number.
    expect(toWhatsAppNumber('1234')).toBeNull();
  });

  it('reports usability consistently', () => {
    expect(hasWhatsAppNumber('087 430 3785')).toBe(true);
    expect(hasWhatsAppNumber('')).toBe(false);
    expect(hasWhatsAppNumber('call the shop')).toBe(false);
  });
});
