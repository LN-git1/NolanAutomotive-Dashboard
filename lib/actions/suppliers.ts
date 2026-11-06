'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { guardedWrite } from '@/lib/actions/safe';
import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { applySupplierPayment } from '@/lib/db/queries/supplier-ledger';
import { supplierLedger, supplierLimits, suppliers } from '@/lib/db/schema';
import { runAfterResponse } from '@/lib/push/after';
import { isOwnSupplierReceiptPath } from '@/lib/storage/receipt-path';
import { toCents } from '@/lib/money';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { removeObject, removeObjects } from '@/lib/storage/signedUrl';
import {
  supplierChargeInputSchema,
  supplierEntryIdSchema,
  supplierIdSchema,
  supplierInputSchema,
  supplierLimitSchema,
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

/**
 * After anything that can move a supplier's balance, check it against that
 * supplier's limit and send the alert that is due. Runs after the response has
 * gone, swallows every failure, and loads the push code only when it runs, so
 * it cannot slow down or break recording a purchase or a payment.
 */
function checkSupplierLimitAfterResponse(supplierId: string) {
  runAfterResponse(async () => {
    const { evaluateSupplierLimit } = await import('@/lib/push/supplier-limits');
    await evaluateSupplierLimit(supplierId);
  });
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

  // The receipt path arrives from the browser. It is later used to sign a download
  // and to delete the file, so it must be this supplier's own and nobody else's.
  if (charge.attachmentStoragePath && !isOwnSupplierReceiptPath(charge.attachmentStoragePath, supplierId)) {
    return { ok: false, error: 'Invalid receipt path' };
  }

  try {
    await db.insert(supplierLedger).values({ supplierId, kind: 'charge', ...charge });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save the purchase',
    };
  }

  revalidateSupplier(supplierId);
  checkSupplierLimitAfterResponse(supplierId);
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
  checkSupplierLimitAfterResponse(supplierId);
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

  // A lookup failure here must come back as an error, not reach the error page.
  let existing: { attachmentStoragePath: string | null }[];
  try {
    existing = await db
      .select({ attachmentStoragePath: supplierLedger.attachmentStoragePath })
      .from(supplierLedger)
      .where(eq(supplierLedger.id, entryId))
      .limit(1);
  } catch (error) {
    console.error('[action:deleteSupplierEntry] lookup failed', error);
    return { ok: false, error: 'Could not delete that entry just now — please try again.' };
  }

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
    if (supplierId) {
      revalidatePath(`/suppliers/${supplierId}`);
      checkSupplierLimitAfterResponse(supplierId);
    }
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

  try {
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
  } catch (error) {
    console.error('[action:deleteSupplier] receipt cleanup failed', error);
    return { ok: false, error: 'Could not delete that supplier just now — please try again.' };
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


/**
 * Set how much the garage is willing to owe this supplier. Alerts then fire at
 * 80% of it and again at the limit itself.
 *
 * Saving always resets the alert markers: a new limit is a new line, so if the
 * balance is already past it the owner hears about it straight away instead of
 * silently inheriting "already told" from the old limit.
 */
export async function setSupplierLimit(supplierId: string, limit: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierIdSchema.safeParse({ supplierId });
  if (!parsedId.success) return { ok: false, error: 'Invalid supplier' };

  const parsed = supplierLimitSchema.safeParse(limit);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid limit' };
  }

  const limitCents = toCents(parsed.data);

  try {
    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .limit(1);
    if (!supplier) return { ok: false, error: 'That supplier no longer exists.' };

    await db
      .insert(supplierLimits)
      .values({ supplierId, limitCents })
      .onConflictDoUpdate({
        target: supplierLimits.supplierId,
        set: { limitCents, alert80At: null, alert100At: null, updatedAt: new Date() },
      });
  } catch (error) {
    console.error('[action:setSupplierLimit] failed', error);
    return { ok: false, error: 'Could not save the limit just now — please try again.' };
  }

  revalidatePath(`/suppliers/${supplierId}`);
  checkSupplierLimitAfterResponse(supplierId);
  return { ok: true };
}

/** Stop alerting for this supplier. */
export async function clearSupplierLimit(supplierId: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierIdSchema.safeParse({ supplierId });
  if (!parsedId.success) return { ok: false, error: 'Invalid supplier' };

  try {
    await db.delete(supplierLimits).where(eq(supplierLimits.supplierId, supplierId));
  } catch (error) {
    console.error('[action:clearSupplierLimit] failed', error);
    return { ok: false, error: 'Could not remove the limit just now — please try again.' };
  }

  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true };
}

/**
 * Put a receipt on a purchase that was recorded without one.
 *
 * The browser has already sent the file straight to storage; this records where
 * it is. Three rules keep it safe:
 *   - the file must sit under THIS purchase's own supplier folder, so a receipt
 *     can never be pointed at another supplier's file or anything else in storage;
 *   - only a purchase can carry a receipt (not a payment);
 *   - it only ever fills an empty slot. The update is conditional on there being
 *     no receipt yet, so two people attaching at the same moment cannot replace
 *     each other's file, and an existing receipt is never silently overwritten.
 */
export async function attachSupplierReceipt(entryId: string, storagePath: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierEntryIdSchema.safeParse({ entryId });
  if (!parsedId.success) return { ok: false, error: 'Invalid entry' };

  return guardedWrite('attachSupplierReceipt', async () => {
    const [entry] = await db
      .select({
        supplierId: supplierLedger.supplierId,
        kind: supplierLedger.kind,
        attachmentStoragePath: supplierLedger.attachmentStoragePath,
      })
      .from(supplierLedger)
      .where(eq(supplierLedger.id, entryId))
      .limit(1);

    if (!entry) return { ok: false, error: 'That purchase no longer exists.' };
    if (entry.kind !== 'charge') return { ok: false, error: 'Only a purchase can have a receipt.' };
    if (entry.attachmentStoragePath) return { ok: false, error: 'This purchase already has a receipt.' };
    if (!isOwnSupplierReceiptPath(storagePath, entry.supplierId)) {
      return { ok: false, error: 'Invalid receipt path' };
    }

    const updated = await db
      .update(supplierLedger)
      .set({ attachmentStoragePath: storagePath })
      .where(and(eq(supplierLedger.id, entryId), isNull(supplierLedger.attachmentStoragePath)))
      .returning({ id: supplierLedger.id });

    if (updated.length === 0) return { ok: false, error: 'This purchase already has a receipt.' };

    revalidatePath(`/suppliers/${entry.supplierId}`);
    revalidatePath('/suppliers');
    revalidatePath('/suppliers/missing-receipts');
    return { ok: true };
  });
}
