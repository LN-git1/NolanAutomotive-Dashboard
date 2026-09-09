import { describe, expect, it } from 'vitest';

import { expenseInputSchema, expenseReversalSchema } from '@/lib/validation/expense';

describe('expenseInputSchema', () => {
  const valid = {
    expenseDate: '2026-09-01',
    category: 'rent',
    amount: '850.00',
    note: 'September rent',
    submissionKey: '7d9f3b10-2c4a-4e6b-9f1a-0c3d5e7b9a1c',
  };

  it('accepts a complete valid expense', () => {
    expect(expenseInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects zero and negative amounts', () => {
    expect(expenseInputSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...valid, amount: '-5' }).success).toBe(false);
  });

  it('rejects unknown categories', () => {
    expect(expenseInputSchema.safeParse({ ...valid, category: 'yacht' }).success).toBe(false);
  });

  it('rejects malformed dates', () => {
    expect(expenseInputSchema.safeParse({ ...valid, expenseDate: '01/09/2026' }).success).toBe(
      false,
    );
  });

  it('rejects a future date beyond tomorrow', () => {
    expect(expenseInputSchema.safeParse({ ...valid, expenseDate: '2099-01-01' }).success).toBe(
      false,
    );
  });
});

describe('expenseReversalSchema', () => {
  it('accepts a uuid expense id', () => {
    expect(
      expenseReversalSchema.safeParse({ expenseId: '7d9f3b10-2c4a-4e6b-9f1a-0c3d5e7b9a1c' })
        .success,
    ).toBe(true);
  });

  it('rejects a non-uuid', () => {
    expect(expenseReversalSchema.safeParse({ expenseId: 'nope' }).success).toBe(false);
  });
});
