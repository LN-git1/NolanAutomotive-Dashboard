import { describe, expect, it } from 'vitest';

import {
  MONTH_NAMES,
  buildMonthGrid,
  isoDate,
  monthGridRange,
  resolveMonth,
  shiftMonth,
} from '@/lib/db/queries/schedule';
import type { Job } from '@/lib/db/schema';

const job = (id: string, dueDate: string) => ({ id, dueDate }) as unknown as Job;

describe('isoDate', () => {
  it('zero-pads month and day', () => {
    expect(isoDate(2026, 0, 1)).toBe('2026-01-01');
    expect(isoDate(2026, 11, 25)).toBe('2026-12-25');
  });
});

describe('buildMonthGrid', () => {
  it('always returns whole weeks', () => {
    for (let month = 0; month < 12; month += 1) {
      const cells = buildMonthGrid(2026, month, new Map());
      expect(cells.length % 7, `${MONTH_NAMES[month]} is not a whole number of weeks`).toBe(0);
    }
  });

  /** Irish weeks start Monday, not Sunday — an easy thing to get backwards. */
  it('starts each week on a Monday', () => {
    const cells = buildMonthGrid(2026, 7, new Map());
    const first = new Date(`${cells[0]!.date}T00:00:00Z`);
    expect(first.getUTCDay()).toBe(1);
  });

  it('covers every day of the month exactly once', () => {
    const cells = buildMonthGrid(2026, 7, new Map()).filter((c) => c.inCurrentMonth);
    expect(cells.length).toBe(31);
    expect(new Set(cells.map((c) => c.date)).size).toBe(31);
    expect(cells[0]!.date).toBe('2026-08-01');
    expect(cells.at(-1)!.date).toBe('2026-08-31');
  });

  it('handles February in a leap year', () => {
    const days = buildMonthGrid(2028, 1, new Map()).filter((c) => c.inCurrentMonth);
    expect(days.length).toBe(29);
    expect(days.at(-1)!.date).toBe('2028-02-29');
  });

  it('handles February in a non-leap year', () => {
    const days = buildMonthGrid(2026, 1, new Map()).filter((c) => c.inCurrentMonth);
    expect(days.length).toBe(28);
  });

  it('marks padding days as outside the current month', () => {
    const cells = buildMonthGrid(2026, 7, new Map());
    const padding = cells.filter((c) => !c.inCurrentMonth);
    for (const cell of padding) {
      expect(cell.date.startsWith('2026-08')).toBe(false);
    }
  });

  it('flags weekends', () => {
    const cells = buildMonthGrid(2026, 7, new Map());
    const saturday = cells.find((c) => c.date === '2026-08-01');
    const monday = cells.find((c) => c.date === '2026-08-03');
    expect(saturday?.isWeekend).toBe(true);
    expect(monday?.isWeekend).toBe(false);
  });

  it('places jobs on their due date and leaves other days empty', () => {
    const map = new Map([['2026-08-12', [job('a', '2026-08-12'), job('b', '2026-08-12')]]]);
    const cells = buildMonthGrid(2026, 7, map);

    expect(cells.find((c) => c.date === '2026-08-12')?.jobs).toHaveLength(2);
    expect(cells.find((c) => c.date === '2026-08-13')?.jobs).toHaveLength(0);
  });

  it('marks time-off days and carries the label through, leaving other days untouched', () => {
    const timeOff = new Map([
      ['2026-08-20', 'Family holiday'],
      ['2026-08-21', null],
    ]);
    const cells = buildMonthGrid(2026, 7, new Map(), timeOff);

    const first = cells.find((c) => c.date === '2026-08-20');
    const second = cells.find((c) => c.date === '2026-08-21');
    const untouched = cells.find((c) => c.date === '2026-08-22');

    expect(first?.isTimeOff).toBe(true);
    expect(first?.timeOffLabel).toBe('Family holiday');
    expect(second?.isTimeOff).toBe(true);
    expect(second?.timeOffLabel).toBeNull();
    expect(untouched?.isTimeOff).toBe(false);
    expect(untouched?.timeOffLabel).toBeNull();
  });
});

describe('monthGridRange', () => {
  it('spans exactly the days the grid renders', () => {
    for (const [year, month] of [[2026, 0], [2026, 7], [2028, 1], [2026, 11]] as const) {
      const cells = buildMonthGrid(year, month, new Map());
      const { from, to } = monthGridRange(year, month);
      expect(from, `${year}-${month} start`).toBe(cells[0]!.date);
      expect(to, `${year}-${month} end`).toBe(cells.at(-1)!.date);
    }
  });
});

describe('shiftMonth', () => {
  it('rolls over the year at both ends', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it('moves within a year normally', () => {
    expect(shiftMonth(2026, 5, 1)).toEqual({ year: 2026, month: 6 });
  });
});

describe('resolveMonth', () => {
  it('accepts valid values', () => {
    expect(resolveMonth('2026', '7')).toEqual({ year: 2026, month: 7 });
  });

  /** These come straight from the query string, so they cannot be trusted. */
  it('falls back to the current month for junk input', () => {
    const now = new Date();
    const current = { year: now.getFullYear(), month: now.getMonth() };

    expect(resolveMonth('abc', 'xyz')).toEqual(current);
    expect(resolveMonth('2026', '99')).toEqual(current);
    expect(resolveMonth('2026', '-3')).toEqual(current);
    expect(resolveMonth('1200', '5').year).toBe(current.year);
    expect(resolveMonth(undefined, undefined)).toEqual(current);
  });

  it('accepts month 0 and 11 as valid boundaries', () => {
    expect(resolveMonth('2026', '0').month).toBe(0);
    expect(resolveMonth('2026', '11').month).toBe(11);
  });
});
