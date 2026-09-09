import { describe, expect, it } from 'vitest';

import { monthKeyOf, netExpenseCents, profitCents } from '@/lib/books';

describe('monthKeyOf', () => {
  it('buckets an ISO date to YYYY-MM', () => {
    expect(monthKeyOf('2026-09-01')).toBe('2026-09');
    expect(monthKeyOf('2026-01-31')).toBe('2026-01');
  });
});

describe('netExpenseCents', () => {
  it('sums plain expenses', () => {
    expect(
      netExpenseCents([
        { id: 'a', amountCents: 85000, reversesId: null },
        { id: 'b', amountCents: 12000, reversesId: null },
      ]),
    ).toBe(97000);
  });

  it('nets a reversal against its original', () => {
    expect(
      netExpenseCents([
        { id: 'a', amountCents: 85000, reversesId: null },
        { id: 'b', amountCents: 85000, reversesId: 'a' },
        { id: 'c', amountCents: 90000, reversesId: null },
      ]),
    ).toBe(90000);
  });

  it('ignores an orphan reversal with no matching original', () => {
    expect(netExpenseCents([{ id: 'b', amountCents: 85000, reversesId: 'missing' }])).toBe(0);
  });
});

describe('profitCents', () => {
  it('subtracts out from income', () => {
    expect(profitCents(200000, 97000)).toBe(103000);
  });
});
