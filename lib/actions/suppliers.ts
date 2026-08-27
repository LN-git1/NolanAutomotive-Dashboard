'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { applySupplierPayment } from '@/lib/db/queries/supplier-ledger';
import { supplierLedger, suppliers } from '@/lib/db/schema';
import { toCents } from '@/lib/money';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { removeObject, removeObjects } from '@/lib/storage/signedUrl';
import {
  supplierChargeInputSchema,
  supplierEntryIdSchema,
  supplierIdSchema,
  supplierInputSchema,
  supplierPaymentAmountSchema,
} from '@/lib/validation/supplier';

import type { ActionResult } from './jobs';

/**
 * Every write to a supplier account moves the same three screens: the account
 * itself, the supplier list's balance column, and the Overview tile totalling
 * what is owed to everyone. Kept in one place so a new action cannot ship
 * having refreshed two of the three.
 */
function revalidateSupplier(supplierId: string) {
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath('/suppliers');
  revalidatePath('/');
}

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = supplierInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid supplier details' };
  }

  try {
    await db.insert(suppliers).values(parsed.data);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save the supplier' };
  }

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

/** Put a new purchase on a supplier's account — money added to the bill. */
export async function addSupplierCharge(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = supplierChargeInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid purchase details' };
  }

  const { supplierId, ...charge } = parsed.data;

  try {
    await db.insert(supplierLedger).values({ supplierId, kind: 'charge', ...charge });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save the purchase',
    };
  }

  revalidateSupplier(supplierId);
  return { ok: true };
}

/**
 * Take money off a supplier's account — the whole balance or part of it.
 *
 * Thin on purpose, exactly like `recordPayment` for money coming in: session
 * check and amount validation here, the locking and the arithmetic in
 * `applySupplierPayment` where they can be tested without a request context.
 * "Paid in full" sends no figure at all — the balance is resolved inside that
 * transaction, so a purchase added moments earlier cannot be paid past.
 */
export async function recordSupplierPayment(
  supplierId: string,
  payment: { payInFull: true } | { amount: string },
): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierIdSchema.safeParse({ supplierId });
  if (!parsedId.success) return { ok: false, error: 'Invalid supplier' };

  let amountCents: number | undefined;
  if (!('payInFull' in payment)) {
    const parsedAmount = supplierPaymentAmountSchema.safeParse(payment.amount);
    if (!parsedAmount.success) {
      return { ok: false, error: parsedAmount.error.issues[0]?.message ?? 'Invalid amount' };
    }
    amountCents = toCents(parsedAmount.data);
  }

  const result = await applySupplierPayment(
    supplierId,
    amountCents !== undefined ? { amountCents } : { payInFull: true },
  );

  if (!result.ok) return result;

  revalidateSupplier(supplierId);
  return { ok: true };
}

/**
 * Remove one entry from a supplier's account — a purchase or a payment — and
 * its receipt with it.
 *
 * How a mistake gets corrected here, and deliberately unlike the customer-side
 * ledger: `payments` against an invoice are never deleted, because an invoice
 * is a legal document and its history has to stand. A supplier account is the
 * garage's own running record of what it owes, so a docket keyed in twice is
 * fixed by removing the wrong line rather than by entering a second wrong one
 * to cancel it.
 *
 * The R2 object goes before the row does — best-effort, matching
 * `deleteAttachment` in jobs.ts: the object may already be gone, and that is
 * not a reason to fail the delete the owner actually asked for.
 */
export async function deleteSupplierEntry(entryId: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierEntryIdSchema.safeParse({ entryId });
  if (!parsedId.success) return { ok: false, error: 'Invalid entry' };

  const existing = await db
    .select({ attachmentStoragePath: supplierLedger.attachmentStoragePath })
    .from(supplierLedger)
    .where(eq(supplierLedger.id, entryId))
    .limit(1);

  const receiptPath = existing[0]?.attachmentStoragePath;
  if (receiptPath) {
    try {
      await removeObject(ATTACHMENTS_BUCKET, receiptPath);
    } catch {
      // Storage object may already be gone; removing the row is still correct.
    }
  }

  try {
    const rows = await db
      .delete(supplierLedger)
      .where(eq(supplierLedger.id, entryId))
      .returning({ supplierId: supplierLedger.supplierId });

    const supplierId = rows[0]?.supplierId;
    if (supplierId) revalidatePath(`/suppliers/${supplierId}`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not delete the entry',
    };
  }

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

/**
 * Delete a supplier, and every receipt on their account with it.
 *
 * `supplierLedger.supplierId` is `ON DELETE CASCADE`, so the entries vanish
 * on their own — but the cascade only touches the database. It never removes
 * the R2 objects those rows referenced, so every receipt path has to be read
 * out and cleaned up here, before the cascade takes the rows (and the paths)
 * with it. Bulk `removeObjects`, not a loop of `removeObject`: same best-effort
 * reasoning as `deleteSupplierEntry` above, just for N receipts instead of one.
 */
export async function deleteSupplier(supplierId: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierIdSchema.safeParse({ supplierId });
  if (!parsedId.success) return { ok: false, error: 'Invalid supplier' };

  const entries = await db
    .select({ attachmentStoragePath: supplierLedger.attachmentStoragePath })
    .from(supplierLedger)
    .where(eq(supplierLedger.supplierId, supplierId));

  const receiptPaths = entries
    .map((entry) => entry.attachmentStoragePath)
    .filter((path): path is string => path !== null);

  if (receiptPaths.length > 0) {
    await removeObjects(ATTACHMENTS_BUCKET, receiptPaths);
  }

  try {
    await db.delete(suppliers).where(eq(suppliers.id, supplierId));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not delete the supplier',
    };
  }

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

