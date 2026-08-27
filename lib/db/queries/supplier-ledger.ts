import 'server-only';

import { eq, sql, type SQL } from 'drizzle-orm';

import type { DbOrTx } from '../../counters';
import { todayIsoDate } from '../../format';
import { fromCents } from '../../money';
import { db } from '../index';
import { supplierLedger, suppliers } from '../schema';

/**
 * What a supplier account is owed, in cents, for the `suppliers` row in scope.
 *
 * Charges add, payments take off. Signed, and deliberately not floored: a
 * negative balance is a real state here — the owner can hand a supplier more
 * than has been entered on the account, and that credit has to stay visible
 * rather than round away to "nothing owed". This is the opposite call to
 * `REMAINING_CENTS` in `invoice-state.ts`, which floors at zero, because an
 * invoice is a fixed document that cannot be overpaid while a supplier
 * account is a running total that can.
 *
 * A correlated subquery, matching `INVOICE_PAID_CENTS`: callers select whole
 * supplier rows, and a JOIN + GROUP BY would have to group by every column.
 */
export const SUPPLIER_BALANCE_CENTS: SQL = sql`COALESCE((
  SELECT SUM(CASE WHEN ${supplierLedger.kind} = 'payment'
                  THEN -${supplierLedger.amount}
                  ELSE ${supplierLedger.amount} END) * 100
  FROM ${supplierLedger}
  WHERE ${supplierLedger.supplierId} = ${suppliers.id}
), 0)`;

/**
 * The balance on one supplier account, in cents. Positive means money is
 * owed to them, negative means they are holding a credit.
 *
 * Takes an optional transaction so `recordSupplierPayment` can read it under
 * the same lock it takes on the supplier row.
 */
export async function getSupplierBalanceCents(
  supplierId: string,
  tx: DbOrTx = db,
): Promise<number> {
  const rows = await tx
    .select({
      balanceCents: sql<string>`COALESCE(SUM(CASE WHEN ${supplierLedger.kind} = 'payment'
        THEN -${supplierLedger.amount} ELSE ${supplierLedger.amount} END) * 100, 0)::bigint`,
    })
    .from(supplierLedger)
    .where(eq(supplierLedger.supplierId, supplierId));

  return Number(rows[0]?.balanceCents ?? 0);
}

export interface SupplierPaymentResult {
  ok: boolean;
  error?: string;
}

/**
 * Take money off a supplier account — the exact counterpart of `applyPayment`
 * for money coming in, and written to the same rules for the same reasons.
 *
 * Locks the supplier row `FOR UPDATE` before reading the balance, so two
 * "paid in full" taps from two tabs serialise instead of both resolving the
 * same pre-commit figure and both writing it.
 *
 * `payInFull` is resolved here, inside the transaction, and never taken from
 * the client: a purchase added seconds earlier would otherwise let a stale
 * number through.
 *
 * Where this deliberately differs from `applyPayment`: an amount larger than
 * the balance is allowed. An invoice is a document with a fixed total, so
 * paying more than it says is a mistake. A supplier account is a running
 * total, and the garage does hand a supplier a round sum before that week's
 * dockets have been entered — refusing it would leave the owner unable to
 * record money he has actually paid. The excess simply carries as a credit
 * and the next purchase eats into it.
 *
 * No session check: that is `lib/actions/suppliers.ts`'s job. Keeping it out
 * means this can be tested against a real database without a request context,
 * matching how every other money computation in this app is tested.
 */
export async function applySupplierPayment(
  supplierId: string,
  payment: { payInFull: true } | { amountCents: number },
  options: { reference?: string | null; notes?: string | null } = {},
): Promise<SupplierPaymentResult> {
  try {
    await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id FROM suppliers WHERE id = ${supplierId} FOR UPDATE`,
      );
      if (locked.length === 0) throw new Error('Supplier not found.');

      const balanceCents = await getSupplierBalanceCents(supplierId, tx);

      const amountCents = 'payInFull' in payment ? balanceCents : payment.amountCents;

      if (amountCents <= 0) {
        throw new Error(
          'payInFull' in payment
            ? 'There is nothing owed on this account to pay off.'
            : 'Enter an amount greater than zero.',
        );
      }

      await tx.insert(supplierLedger).values({
        supplierId,
        kind: 'payment',
        amount: fromCents(amountCents),
        /*
          Dated here, not by the caller. The form collects an amount and
          nothing else, and `bill_date` is NOT NULL with no database default —
          so "today" is decided on the server, in the garage's own local
          reckoning of the date (`todayIsoDate`), never from a client clock.
        */
        entryDate: todayIsoDate(),
        reference: options.reference ?? null,
        notes: options.notes ?? null,
      });
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not record the payment.',
    };
  }

  return { ok: true };
}
