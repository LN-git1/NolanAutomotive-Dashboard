import 'server-only';

import { and, eq, isNull, or, isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getSupplierBalanceCents } from '@/lib/db/queries/supplier-ledger';
import { supplierLimits, suppliers } from '@/lib/db/schema';

import { supplierBalancePayload } from './payload';
import { sendPush } from './send';
import { supplierLevel } from './supplier-level';

/**
 * A supplier's limit, or what to show when there is none or it cannot be read.
 *
 * `available: false` means the table could not be read (it has not been created
 * yet, or the database is struggling). The supplier page uses that to hide the
 * limit card instead of failing, so shipping this code before the database
 * change cannot break a screen that works today.
 */
export type LimitLookup =
  | { available: true; limitCents: number | null }
  | { available: false };

export async function getSupplierLimit(supplierId: string): Promise<LimitLookup> {
  try {
    const rows = await db
      .select({ limitCents: supplierLimits.limitCents })
      .from(supplierLimits)
      .where(eq(supplierLimits.supplierId, supplierId))
      .limit(1);
    return { available: true, limitCents: rows[0]?.limitCents ?? null };
  } catch {
    return { available: false };
  }
}

/**
 * Check one supplier's balance against its limit and send the alert that is
 * due, if any.
 *
 * Called after anything that can move the balance: a purchase, a payment, an
 * entry deleted, or the limit itself changing. Each alert is CLAIMED with a
 * conditional UPDATE (`... WHERE alert_80_at IS NULL RETURNING`), so two
 * purchases saved at the same moment cannot both send it: exactly one UPDATE
 * matches the row and gets a result back.
 */
export async function evaluateSupplierLimit(supplierId: string): Promise<void> {
  const [limit] = await db
    .select()
    .from(supplierLimits)
    .where(eq(supplierLimits.supplierId, supplierId))
    .limit(1);
  if (!limit) return;

  const balanceCents = await getSupplierBalanceCents(supplierId);
  const level = supplierLevel(balanceCents, limit.limitCents);
  const now = new Date();

  if (level === 'below') {
    // Back under 80%: both alerts may fire again next time. Only write when
    // there is something to clear, so a quiet account causes no database writes.
    await db
      .update(supplierLimits)
      .set({ alert80At: null, alert100At: null })
      .where(
        and(
          eq(supplierLimits.supplierId, supplierId),
          or(isNotNull(supplierLimits.alert80At), isNotNull(supplierLimits.alert100At)),
        ),
      );
    return;
  }

  let send: 80 | 100 | null = null;

  if (level === 'warn') {
    // Came back down from the limit: the 100% alert may fire again, the 80% one was already sent.
    await db
      .update(supplierLimits)
      .set({ alert100At: null })
      .where(and(eq(supplierLimits.supplierId, supplierId), isNotNull(supplierLimits.alert100At)));

    const claimed = await db
      .update(supplierLimits)
      .set({ alert80At: now })
      .where(and(eq(supplierLimits.supplierId, supplierId), isNull(supplierLimits.alert80At)))
      .returning({ id: supplierLimits.supplierId });
    if (claimed.length > 0) send = 80;
  } else {
    const claimed = await db
      .update(supplierLimits)
      .set({ alert100At: now, alert80At: limit.alert80At ?? now })
      .where(and(eq(supplierLimits.supplierId, supplierId), isNull(supplierLimits.alert100At)))
      .returning({ id: supplierLimits.supplierId });
    if (claimed.length > 0) send = 100;
  }

  if (!send) return;

  const [supplier] = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);
  if (!supplier) return;

  await sendPush(
    'supplier',
    supplierBalancePayload({
      supplierName: supplier.name,
      supplierId,
      level: send,
      balanceCents,
      limitCents: limit.limitCents,
    }),
  );
}
