import 'server-only';

import { db } from '../index';
import { supplierLimits } from '../schema';

/**
 * Every supplier's rough limit, keyed by supplier id. Suppliers with no limit
 * are simply absent.
 *
 * `null` means the limits table could not be read (not created yet, or the
 * database is struggling). Callers treat that as "show no limits" so the
 * suppliers page and Settings keep working either way. One plain query with no
 * retry wrapper: it is read alongside other queries on pages that already sit
 * near the connection cap.
 */
export async function listSupplierLimits(): Promise<Map<string, number> | null> {
  try {
    const rows = await db
      .select({ supplierId: supplierLimits.supplierId, limitCents: supplierLimits.limitCents })
      .from(supplierLimits);
    return new Map(rows.map((row) => [row.supplierId, row.limitCents]));
  } catch {
    return null;
  }
}
