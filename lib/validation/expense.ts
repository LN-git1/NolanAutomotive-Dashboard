import { z } from 'zod';

import { decimalString, optionalText, requiredDate, uuidString } from './common';

export const EXPENSE_CATEGORIES = [
  'rent',
  'wages',
  'utilities',
  'fuel',
  'parts',
  'insurance',
  'phone',
  'other',
] as const;

/** UI labels. `parts` is never supplier stock — that lives on the supplier ledger. */
export const EXPENSE_CATEGORY_LABELS: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  rent: 'Rent',
  wages: 'Wages',
  utilities: 'Utilities',
  fuel: 'Fuel',
  parts: 'Parts (non-supplier)',
  insurance: 'Insurance',
  phone: 'Phone',
  other: 'Other',
};

function todayPlusOneIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export const expenseInputSchema = z.object({
  expenseDate: requiredDate.refine((value) => value <= todayPlusOneIso(), 'Date cannot be in the future'),
  category: z.enum(EXPENSE_CATEGORIES),
  // decimalString already enforces positive; the extra refine kills "0".
  amount: decimalString({ label: 'Amount', maxIntegerDigits: 8 }).refine(
    (value) => value !== '' && Number(value) > 0,
    'Amount must be more than zero',
  ),
  note: optionalText,
  submissionKey: uuidString,
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const expenseReversalSchema = z.object({ expenseId: uuidString });

export type ExpenseReversalInput = z.infer<typeof expenseReversalSchema>;
