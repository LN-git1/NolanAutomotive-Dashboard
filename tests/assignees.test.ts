import { describe, expect, it } from 'vitest';

import { creditByMonth, splitCents, UNASSIGNED } from '@/lib/assignees';
import { assigneeInputSchema, jobAssigneeIdsSchema } from '@/lib/validation/assignee';

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('splitCents', () => {
  it('gives one person the whole amount', () => {
    expect(splitCents(100_000, ['a']).get('a')).toBe(100_000);
  });

  it('splits two ways equally', () => {
    const shares = splitCents(100_000, ['a', 'b']);
    expect(shares.get('a')).toBe(50_000);
    expect(shares.get('b')).toBe(50_000);
  });

  it('never loses a cent when it does not divide evenly', () => {
    const shares = splitCents(100, ['a', 'b', 'c']);
    expect(sum(shares)).toBe(100);
    expect([...shares.values()].sort()).toEqual([33, 33, 34]);
  });

  it('credits Unassigned when nobody is on the job', () => {
    expect(splitCents(5_000, []).get(UNASSIGNED)).toBe(5_000);
  });

  it('keeps refunds (negative money) summing exactly', () => {
    expect(sum(splitCents(-100, ['a', 'b', 'c']))).toBe(-100);
  });
});

describe('creditByMonth', () => {
  it('totals per month and per person, including Unassigned', () => {
    const credit = creditByMonth([
      { monthKey: '2026-10', cents: 100_000, assigneeIds: ['a'] },
      { monthKey: '2026-10', cents: 60_000, assigneeIds: ['a', 'b'] },
      { monthKey: '2026-10', cents: 7_000, assigneeIds: [] },
      { monthKey: '2026-09', cents: 20_000, assigneeIds: ['b'] },
    ]);

    const october = credit.get('2026-10')!;
    expect(october.get('a')).toBe(130_000);
    expect(october.get('b')).toBe(30_000);
    expect(october.get(UNASSIGNED)).toBe(7_000);
    expect(sum(october)).toBe(167_000);
    expect(credit.get('2026-09')!.get('b')).toBe(20_000);
  });

  it('gives the same split regardless of input order of ids', () => {
    const one = creditByMonth([{ monthKey: '2026-10', cents: 101, assigneeIds: ['b', 'a'] }]);
    const two = creditByMonth([{ monthKey: '2026-10', cents: 101, assigneeIds: ['a', 'b'] }]);
    expect(one.get('2026-10')).toEqual(two.get('2026-10'));
  });
});

describe('assignee validation', () => {
  it('requires a name and trims it', () => {
    expect(assigneeInputSchema.safeParse({ name: '  ' }).success).toBe(false);
    const ok = assigneeInputSchema.safeParse({ name: '  Lee ' });
    expect(ok.success && ok.data.name).toBe('Lee');
  });

  it('collapses duplicate ids and rejects non-uuids', () => {
    const id = '3f2b8c1e-6d0a-4c52-9a7e-1b2c3d4e5f60';
    const ok = jobAssigneeIdsSchema.safeParse([id, id]);
    expect(ok.success && ok.data).toEqual([id]);
    expect(jobAssigneeIdsSchema.safeParse(['nope']).success).toBe(false);
  });
});
