import 'server-only';

import { eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../counters';
import { formatEur, fromCents, toCents } from '../../money';
import { db } from '../index';
import { invoices, jobs, payments } from '../schema';

/**
 * The single source of truth for "how much has been paid against this
 * invoice." Every consumer of that number — the void guard, the regenerate
 * guard, and `applyPayment` itself — goes through this function rather than
 * summing `payments` ad hoc, so the same rounding and the same "no rows yet"
 * handling apply everywhere.
 *
 * Takes an optional transaction so `applyPayment` can call this AFTER
 * locking the job row, inside the same transaction, and see a consistent
 * view of payments made so far under that lock.
 */
export async function getPaidCentsForInvoice(invoiceId: string, tx: DbOrTx = db): Promise<number> {
  const rows = await tx
    .select({ paidCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint` })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));

  return Number(rows[0]?.paidCents ?? 0);
}

export interface ApplyPaymentResult {
  ok: boolean;
  error?: string;
  jobId?: string;
}

/**
 * The transactional core of recording a payment — no session check (that's
 * `lib/actions/payments.ts`'s job, the only caller outside tests), so this
 * can be exercised directly against a real database in tests, matching how
 * every other money computation in this app is tested at the query layer
 * rather than through its action wrapper.
 *
 * Locks the JOBS row (`FOR UPDATE`) before computing the remaining balance —
 * matching the exact lock target `/api/invoices/generate` already uses for
 * the adjacent "issue a new invoice" race — so two calls against the same
 * invoice serialise instead of both reading the same pre-commit remaining
 * balance and both succeeding.
 */
export async function applyPayment(
  invoiceId: string,
  payment: { payInFull: true } | { amountCents: number },
): Promise<ApplyPaymentResult> {
  let jobId: string | undefined;

  try {
    await db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) throw new Error('Invoice not found.');
      if (invoice.voidedAt) throw new Error('This invoice has been voided.');

      jobId = invoice.jobId;

      await tx.execute(sql`SELECT id FROM jobs WHERE id = ${invoice.jobId} FOR UPDATE`);

      const paidCents = await getPaidCentsForInvoice(invoiceId, tx);
      const grandTotalCents = toCents(invoice.grandTotal);
      const remainingCents = Math.max(grandTotalCents - paidCents, 0);

      const amountCents = 'payInFull' in payment ? remainingCents : payment.amountCents;

      if (amountCents <= 0) throw new Error('Enter an amount greater than zero.');
      if (amountCents > remainingCents) {
        throw new Error(`That's more than the ${formatEur(remainingCents)} still owed.`);
      }

      await tx.insert(payments).values({ invoiceId, amount: fromCents(amountCents) });

      if (paidCents + amountCents >= grandTotalCents) {
        await tx
          .update(jobs)
          .set({ status: 'paid', updatedAt: new Date() })
          .where(eq(jobs.id, invoice.jobId));
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not record the payment.',
    };
  }

  return { ok: true, jobId };
}
