'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { guardedWrite } from '@/lib/actions/safe';
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

  return guardedWrite('addExpense', async () => {
    await db
      .insert(expenses)
      .values({
        expenseDate: parsed.data.expenseDate,
        category: parsed.data.category,
        amount: parsed.data.amount,
        note: parsed.data.note,
        submissionKey: parsed.data.submissionKey,
      })
      // A conflict on the submission key is a retried POST after a successful
      // insert. The expense IS recorded, so it is reported as success.
      .onConflictDoNothing({ target: expenses.submissionKey });

    revalidateBooks();
    return { ok: true };
  });
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

  // One transaction with the original row locked: two rapid clicks queue on the
  // lock, and the second sees the first's correction and refuses.
  const result = await guardedWrite('reverseExpense', () =>
    db.transaction(async (tx): Promise<ActionResult> => {
      const original = await tx
        .select({
          id: expenses.id,
          expenseDate: expenses.expenseDate,
          category: expenses.category,
          amount: expenses.amount,
          note: expenses.note,
          reversesId: expenses.reversesId,
        })
        .from(expenses)
        .where(eq(expenses.id, parsed.data.expenseId))
        .for('update');

      const row = original[0];
      if (!row) return { ok: false, error: 'Expense not found' };
      if (row.reversesId !== null) return { ok: false, error: 'This correction has already been made' };

      const alreadyReversed = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.reversesId, row.id));
      if (alreadyReversed.length > 0) return { ok: false, error: 'This expense was already corrected' };

      await tx.insert(expenses).values({
        expenseDate: row.expenseDate,
        category: row.category,
        amount: row.amount,
        note: row.note ? `Correction of: ${row.note}` : 'Correction',
        reversesId: row.id,
      });

      return { ok: true };
    }),
  );

  // Only after the transaction has committed.
  if (result.ok) revalidateBooks();
  return result;
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

  return guardedWrite('attachExpenseReceipt', async () => {
    await db
      .update(expenses)
      .set({ receiptStoragePath: storagePath })
      .where(eq(expenses.id, parsed.data.expenseId));

    revalidateBooks();
    return { ok: true };
  });
}
