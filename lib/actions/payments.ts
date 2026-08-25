'use server';

import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { applyPayment } from '@/lib/db/queries/payments';
import { toCents } from '@/lib/money';
import { invoiceIdSchema, paymentAmountSchema } from '@/lib/validation/payments';

import type { ActionResult } from './jobs';

/**
 * Record a payment against an invoice — full or partial. One action, two
 * ways of arriving at an amount, not two code paths: `payInFull` resolves to
 * the current remaining balance inside `applyPayment`'s transaction, never
 * from a client-supplied figure — a second tab, or a regenerate that changed
 * the total moments earlier, would otherwise be able to send a stale number.
 *
 * Thin on purpose: session check and input validation here, the actual
 * locking/arithmetic/status-flip lives in `applyPayment` so it can be tested
 * directly without a request context.
 */
export async function recordPayment(
  invoiceId: string,
  payment: { payInFull: true } | { amount: string },
): Promise<ActionResult> {
  await requireSession();

  const parsedId = invoiceIdSchema.safeParse({ invoiceId });
  if (!parsedId.success) return { ok: false, error: 'Invalid invoice' };

  let amountCents: number | undefined;
  if (!('payInFull' in payment)) {
    const parsedAmount = paymentAmountSchema.safeParse(payment.amount);
    if (!parsedAmount.success) {
      return { ok: false, error: parsedAmount.error.issues[0]?.message ?? 'Invalid amount' };
    }
    amountCents = toCents(parsedAmount.data);
  }

  const result = await applyPayment(
    invoiceId,
    amountCents !== undefined ? { amountCents } : { payInFull: true },
  );

  if (!result.ok) return result;

  revalidatePath('/jobs');
  if (result.jobId) revalidatePath(`/jobs/${result.jobId}`);
  revalidatePath('/awaiting-payments');
  // A payment that settles the invoice moves the job from Jobs to Paid jobs.
  revalidatePath('/paid-jobs');
  revalidatePath('/earnings');
  revalidatePath('/');
  return result;
}
