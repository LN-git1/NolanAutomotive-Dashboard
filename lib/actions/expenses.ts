'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { expenses } from '@/lib/db/schema';
import { expenseInputSchema, expenseReversalSchema } from '@/lib/validation/expense';

import type { ActionResult } from './jobs';

function revalidateBooks() {
  revalidatePath('/earnings');
  revalidatePath('/');
}

/** Record a running cost. Thin like `addSupplierCharge`: validate here, insert, revalidate. */
export async function addExpense(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = expenseInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid expense details' };
  }

  const rows = await db
    .insert(expenses)
    .values({
      expenseDate: parsed.data.expenseDate,
      category: parsed.data.category,
      amount: parsed.data.amount,
      note: parsed.data.note,
      submissionKey: parsed.data.submissionKey,
    })
    .onConflictDoNothing({ target: expenses.submissionKey })
    .returning({ id: expenses.id });

  // Zero rows back means the submission key already exists: a retried POST
  // after a successful insert. Report success — the expense IS recorded.
  if (rows.length === 0) {
    revalidateBooks();
    return { ok: true };
  }

  revalidateBooks();
  return { ok: true };
}

/**
 * Correct an expense with a second row pointing back at the original — never
 * an UPDATE. Both rows render in the month so it still reconciles, and the
 * reversal nets to zero against its target in `netExpenseCents`.
 */
export async function reverseExpense(expenseId: string): Promise<ActionResult> {
  await requireSession();

  const parsed = expenseReversalSchema.safeParse({ expenseId });
  if (!parsed.success) return { ok: false, error: 'Invalid expense' };

  const original = await db
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      category: expenses.category,
      amount: expenses.amount,
      note: expenses.note,
      reversesId: expenses.reversesId,
    })
    .from(expenses)
    .where(eq(expenses.id, parsed.data.expenseId));

  const row = original[0];
  if (!row) return { ok: false, error: 'Expense not found' };
  if (row.reversesId !== null) return { ok: false, error: 'This correction has already been made' };

  const alreadyReversed = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.reversesId, row.id));
  if (alreadyReversed.length > 0) return { ok: false, error: 'This expense was already corrected' };

  await db.insert(expenses).values({
    expenseDate: row.expenseDate,
    category: row.category,
    amount: row.amount,
    note: row.note ? `Correction of: ${row.note}` : 'Correction',
    reversesId: row.id,
  });

  revalidateBooks();
  return { ok: true };
}

/** Record a receipt path after the browser has PUT the file straight to R2. */
export async function attachExpenseReceipt(
  expenseId: string,
  storagePath: string,
): Promise<ActionResult> {
  await requireSession();

  const parsed = expenseReversalSchema.safeParse({ expenseId });
  if (!parsed.success) return { ok: false, error: 'Invalid expense' };
  if (!storagePath.startsWith('expenses/')) return { ok: false, error: 'Invalid receipt path' };

  await db
    .update(expenses)
    .set({ receiptStoragePath: storagePath })
    .where(eq(expenses.id, parsed.data.expenseId));

  revalidateBooks();
  return { ok: true };
}
