import { describe, expect, it } from 'vitest';

import { formatDateTime, formatDueDateTime, formatTime } from '@/lib/format';
import { settingsInputSchema } from '@/lib/validation/settings';

describe('formatTime', () => {
  describe('12-hour format (default)', () => {
    it('formats morning times with am suffix and no leading zero on hour', () => {
      expect(formatTime('09:30')).toBe('9:30am');
      expect(formatTime('09:30', '12h')).toBe('9:30am');
      expect(formatTime('08:05', '12h')).toBe('8:05am');
      expect(formatTime('11:45', '12h')).toBe('11:45am');
    });

    it('formats midnight as 12:xxam', () => {
      expect(formatTime('00:00', '12h')).toBe('12:00am');
      expect(formatTime('00:15', '12h')).toBe('12:15am');
    });

    it('formats noon as 12:xxpm', () => {
      expect(formatTime('12:00', '12h')).toBe('12:00pm');
      expect(formatTime('12:30', '12h')).toBe('12:30pm');
    });

    it('formats afternoon and evening times with pm suffix and converted hour', () => {
      expect(formatTime('13:00', '12h')).toBe('1:00pm');
      expect(formatTime('16:30', '12h')).toBe('4:30pm');
      expect(formatTime('20:15', '12h')).toBe('8:15pm');
      expect(formatTime('23:59', '12h')).toBe('11:59pm');
    });

    it('returns null for missing or invalid values', () => {
      expect(formatTime(null)).toBeNull();
      expect(formatTime(undefined)).toBeNull();
      expect(formatTime('')).toBeNull();
      expect(formatTime('invalid')).toBeNull();
      expect(formatTime('9:30')).toBeNull(); // not zero-padded HH:MM
    });
  });

  describe('24-hour format', () => {
    it('preserves 24-hour HH:MM notation exactly', () => {
      expect(formatTime('00:00', '24h')).toBe('00:00');
      expect(formatTime('09:30', '24h')).toBe('09:30');
      expect(formatTime('12:00', '24h')).toBe('12:00');
      expect(formatTime('13:05', '24h')).toBe('13:05');
      expect(formatTime('16:30', '24h')).toBe('16:30');
      expect(formatTime('23:59', '24h')).toBe('23:59');
    });

    it('returns null for missing or invalid values', () => {
      expect(formatTime(null, '24h')).toBeNull();
      expect(formatTime(undefined, '24h')).toBeNull();
      expect(formatTime('', '24h')).toBeNull();
      expect(formatTime('invalid', '24h')).toBeNull();
    });
  });
});

describe('formatDueDateTime', () => {
  it('combines date and time in 12-hour format', () => {
    expect(formatDueDateTime('2026-08-15', '16:30', '12h')).toBe('15/08/2026 · 4:30pm');
    expect(formatDueDateTime('2026-08-15', '09:00', '12h')).toBe('15/08/2026 · 9:00am');
  });

  it('combines date and time in 24-hour format', () => {
    expect(formatDueDateTime('2026-08-15', '16:30', '24h')).toBe('15/08/2026 · 16:30');
    expect(formatDueDateTime('2026-08-15', '09:00', '24h')).toBe('15/08/2026 · 09:00');
  });

  it('formats date only when no time is given', () => {
    expect(formatDueDateTime('2026-08-15', null, '12h')).toBe('15/08/2026');
    expect(formatDueDateTime('2026-08-15', null, '24h')).toBe('15/08/2026');
    expect(formatDueDateTime('2026-08-15', '', '24h')).toBe('15/08/2026');
  });

  it('formats time only when no date is given', () => {
    expect(formatDueDateTime(null, '16:30', '12h')).toBe('4:30pm');
    expect(formatDueDateTime(null, '16:30', '24h')).toBe('16:30');
  });

  it('returns fallback dash when neither is given', () => {
    expect(formatDueDateTime(null, null)).toBe('—');
    expect(formatDueDateTime('', '')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('formats dates with 12-hour and 24-hour times', () => {
    const testDate = new Date(2026, 7, 15, 16, 30); // 15 Aug 2026 16:30 local
    expect(formatDateTime(testDate, '12h')).toBe('15/08/2026 4:30pm');
    expect(formatDateTime(testDate, '24h')).toBe('15/08/2026 16:30');
  });

  it('returns fallback dash for null/invalid dates', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('invalid-date')).toBe('—');
  });
});

describe('settingsInputSchema timeFormat validation', () => {
  it('accepts 12h and 24h values', () => {
    const result12 = settingsInputSchema.safeParse({ timeFormat: '12h' });
    expect(result12.success).toBe(true);
    if (result12.success) {
      expect(result12.data.timeFormat).toBe('12h');
    }

    const result24 = settingsInputSchema.safeParse({ timeFormat: '24h' });
    expect(result24.success).toBe(true);
    if (result24.success) {
      expect(result24.data.timeFormat).toBe('24h');
    }
  });

  it('defaults to 12h when timeFormat is omitted', () => {
    const result = settingsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeFormat).toBe('12h');
    }
  });

  it('rejects invalid timeFormat values', () => {
    const result = settingsInputSchema.safeParse({ timeFormat: 'auto' });
    expect(result.success).toBe(false);
  });
});
