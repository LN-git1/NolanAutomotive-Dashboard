'use server';

import { requireSession } from '@/lib/auth/require-session';
import { getEarningsMonthInvoices, type EarningsMonthInvoice } from '@/lib/db/queries/earnings';
import { earningsMonthKeySchema } from '@/lib/validation/earnings';

/** Called only when a month row is actually expanded — never on page load. */
export async function getEarningsMonthDetail(monthKey: string): Promise<EarningsMonthInvoice[]> {
  await requireSession();

  const parsed = earningsMonthKeySchema.safeParse({ monthKey });
  if (!parsed.success) return [];

  return getEarningsMonthInvoices(parsed.data.monthKey);
}
