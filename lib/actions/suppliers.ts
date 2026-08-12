'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { supplierBills, suppliers } from '@/lib/db/schema';
import { supplierBillInputSchema, supplierInputSchema } from '@/lib/validation/supplier';

import type { ActionResult } from './jobs';

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = supplierInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid supplier details' };
  }

  await db.insert(suppliers).values(parsed.data);

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

  await db.insert(supplierBills).values({ supplierId, ...bill });

  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

/** Toggle a bill between outstanding and paid. */
export async function setBillPaid(billId: string, paid: boolean): Promise<ActionResult> {
  await requireSession();

  const rows = await db
    .update(supplierBills)
    .set({ paidAt: paid ? new Date() : null })
    .where(eq(supplierBills.id, billId))
    .returning({ supplierId: supplierBills.supplierId });

  const supplierId = rows[0]?.supplierId;
  if (supplierId) revalidatePath(`/suppliers/${supplierId}`);

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}

export async function deleteSupplierBill(billId: string): Promise<ActionResult> {
  await requireSession();

  const rows = await db
    .delete(supplierBills)
    .where(eq(supplierBills.id, billId))
    .returning({ supplierId: supplierBills.supplierId });

  const supplierId = rows[0]?.supplierId;
  if (supplierId) revalidatePath(`/suppliers/${supplierId}`);

  revalidatePath('/suppliers');
  revalidatePath('/');
  return { ok: true };
}
