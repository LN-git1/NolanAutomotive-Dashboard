'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { supplierBills, suppliers } from '@/lib/db/schema';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { removeObject, removeObjects } from '@/lib/storage/signedUrl';
import {
  billIdSchema,
  supplierBillInputSchema,
  supplierIdSchema,
  supplierInputSchema,
} from '@/lib/validation/supplier';

import type { ActionResult } from './jobs';

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

export async function addSupplierBill(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = supplierBillInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid bill details' };
  }

  const { supplierId, ...bill } = parsed.data;

  try {
    await db.insert(supplierBills).values({ supplierId, ...bill });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save the bill' };
  }

  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

/** Toggle a bill between outstanding and paid. */
export async function setBillPaid(billId: string, paid: boolean): Promise<ActionResult> {
  await requireSession();

  const parsedId = billIdSchema.safeParse({ billId });
  if (!parsedId.success) return { ok: false, error: 'Invalid bill' };

  try {
    const rows = await db
      .update(supplierBills)
      .set({ paidAt: paid ? new Date() : null })
      .where(eq(supplierBills.id, billId))
      .returning({ supplierId: supplierBills.supplierId });

    const supplierId = rows[0]?.supplierId;
    if (supplierId) revalidatePath(`/suppliers/${supplierId}`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not update the bill',
    };
  }

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

/**
 * Delete a bill, and — unlike before — its receipt with it.
 *
 * `deleteAttachment` (jobs.ts) has always cleaned up its object in R2 before
 * removing the row; this one never did, so every deleted bill with a receipt
 * left an orphaned file behind permanently. Best-effort, matching that
 * function's reasoning: the object may already be gone, and that is not a
 * reason to fail the delete the owner actually asked for.
 */
export async function deleteSupplierBill(billId: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = billIdSchema.safeParse({ billId });
  if (!parsedId.success) return { ok: false, error: 'Invalid bill' };

  const existing = await db
    .select({ attachmentStoragePath: supplierBills.attachmentStoragePath })
    .from(supplierBills)
    .where(eq(supplierBills.id, billId))
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
      .delete(supplierBills)
      .where(eq(supplierBills.id, billId))
      .returning({ supplierId: supplierBills.supplierId });

    const supplierId = rows[0]?.supplierId;
    if (supplierId) revalidatePath(`/suppliers/${supplierId}`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not delete the bill',
    };
  }

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

/**
 * Delete a supplier, and every bill's receipt with it.
 *
 * `supplierBills.supplierId` is `ON DELETE CASCADE`, so the bill rows vanish
 * on their own — but the cascade only touches the database. It never removes
 * the R2 objects those rows referenced, so every receipt path has to be read
 * out and cleaned up here, before the cascade takes the rows (and the paths)
 * with it. Bulk `removeObjects`, not a loop of `removeObject`: same best-effort
 * reasoning as `deleteSupplierBill` above, just for N receipts instead of one.
 */
export async function deleteSupplier(supplierId: string): Promise<ActionResult> {
  await requireSession();

  const parsedId = supplierIdSchema.safeParse({ supplierId });
  if (!parsedId.success) return { ok: false, error: 'Invalid supplier' };

  const bills = await db
    .select({ attachmentStoragePath: supplierBills.attachmentStoragePath })
    .from(supplierBills)
    .where(eq(supplierBills.supplierId, supplierId));

  const receiptPaths = bills
    .map((bill) => bill.attachmentStoragePath)
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

