'use server';

import { requireSession } from '@/lib/auth/require-session';
import {
  getBooksMonthDetail as fetchBooksMonthDetail,
  type BooksMonthDetail,
} from '@/lib/db/queries/books';
import { getEarningsMonthInvoices, type EarningsMonthInvoice } from '@/lib/db/queries/earnings';
import { earningsMonthKeySchema } from '@/lib/validation/earnings';

/** Called only when a month row is actually expanded — never on page load. */
export async function getEarningsMonthDetail(monthKey: string): Promise<EarningsMonthInvoice[]> {
  await requireSession();

  const parsed = earningsMonthKeySchema.safeParse({ monthKey });
  if (!parsed.success) return [];

  return getEarningsMonthInvoices(parsed.data.monthKey);
}

/** Books version: income + supplier + expense lines for one expanded month. */
export async function getBooksMonthDetail(monthKey: string): Promise<BooksMonthDetail> {
  await requireSession();

  const parsed = earningsMonthKeySchema.safeParse({ monthKey });
  if (!parsed.success) return { income: [], supplier: [], expenses: [] };

  return fetchBooksMonthDetail(parsed.data.monthKey);
}
