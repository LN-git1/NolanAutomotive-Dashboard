import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { withDbRetry } from '../retry';
import { supplierLedger, suppliers } from '../schema';

/**
 * Every supplier purchase that has no receipt attached.
 *
 * This exists for the accountant: they go through the paper receipts the garage
 * hands over and need to see, for each purchase the app knows about, whether the
 * receipt has been filed. Nothing new is recorded to make this possible. The
 * amount, the date of the purchase, the supplier and the moment it was typed in
 * (`createdAt`) are already stored on every entry; a missing receipt is simply
 * an empty `attachment_storage_path`. Payments are left out: money paid to a
 * supplier is not a purchase and has no docket.
 *
 * Newest purchase first, then newest entry first, the same order the supplier
 * history uses.
 */
export interface MissingReceipt {
  id: string;
  supplierId: string;
  supplierName: string;
  /** numeric(12,2) as a string, exactly as stored. */
  amount: string;
  entryDate: string;
  reference: string | null;
  notes: string | null;
  /** When this entry was typed into the app. */
  createdAt: Date;
}

export async function listChargesMissingReceipts(): Promise<MissingReceipt[]> {
  return withDbRetry('suppliers:missing-receipts', () =>
    db
      .select({
        id: supplierLedger.id,
        supplierId: supplierLedger.supplierId,
        supplierName: suppliers.name,
        amount: supplierLedger.amount,
        entryDate: supplierLedger.entryDate,
        reference: supplierLedger.reference,
        notes: supplierLedger.notes,
        createdAt: supplierLedger.createdAt,
      })
      .from(supplierLedger)
      .innerJoin(suppliers, eq(supplierLedger.supplierId, suppliers.id))
      .where(and(eq(supplierLedger.kind, 'charge'), isNull(supplierLedger.attachmentStoragePath)))
      .orderBy(desc(supplierLedger.entryDate), desc(supplierLedger.createdAt)),
  );
}

/**
 * How many purchases are missing a receipt, for the badge on the suppliers
 * page. Never throws: a badge is not worth failing the page over, so any
 * trouble reads as "none to show".
 */
export async function countChargesMissingReceipts(): Promise<number> {
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(supplierLedger)
      .where(and(eq(supplierLedger.kind, 'charge'), isNull(supplierLedger.attachmentStoragePath)));
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}
