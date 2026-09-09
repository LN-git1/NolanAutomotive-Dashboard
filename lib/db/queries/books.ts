import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { netExpenseCents, profitCents } from '@/lib/books';
import { toCents } from '@/lib/money';

import { db } from '../index';
import { expenses, invoices, jobs, payments, supplierLedger } from '../schema';
import { MONTH_NAMES } from './schedule';

const LIVE_INVOICE = and(isNull(invoices.voidedAt), isNull(jobs.deletedAt));
const INCOME_MONTH = sql`COALESCE(${jobs.dueDate}, ${invoices.issueDate})`;
const SUPPLIER_MONTH = supplierLedger.entryDate;
const EXPENSE_MONTH = expenses.expenseDate;

export interface BooksMonth {
  key: string;
  label: string;
  incomeCents: number;
  outCents: number;
  profitCents: number;
}

export interface BooksSummary {
  yearToDateIncomeCents: number;
  yearToDateOutCents: number;
  yearToDateProfitCents: number;
  months: BooksMonth[];
}

function labelFor(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

function sumByMonth<T extends { monthKey: string; cents: number }>(rows: T[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.monthKey, (totals.get(row.monthKey) ?? 0) + row.cents);
  return totals;
}

/**
 * Monthly P&L. Three small aggregate queries (income, supplier charges,
 * expenses) merged in code by month key — deliberately not one mega-JOIN, so
 * each leg stays readable and a month with only one kind of movement still
 * appears. Supplier `payment` entries are excluded from Out: they settle a
 * liability already counted as a charge, and counting both would double-count
 * outgoings. Reversal netting happens in `netExpenseCents`, not SQL.
 */
export async function getBooksSummary(): Promise<BooksSummary> {
  const yearPrefix = `${new Date().getFullYear()}-`;

  const [incomeRows, supplierRows, expenseRows] = await Promise.all([
    db
      .select({
        monthKey: sql<string>`to_char(date_trunc('month', ${INCOME_MONTH}), 'YYYY-MM')`,
        cents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(LIVE_INVOICE)
      .groupBy(sql`date_trunc('month', ${INCOME_MONTH})`),
    db
      .select({
        monthKey: sql<string>`to_char(date_trunc('month', ${SUPPLIER_MONTH}), 'YYYY-MM')`,
        cents: sql<string>`COALESCE(SUM(${supplierLedger.amount}) * 100, 0)::bigint`,
      })
      .from(supplierLedger)
      .where(eq(supplierLedger.kind, 'charge'))
      .groupBy(sql`date_trunc('month', ${SUPPLIER_MONTH})`),
    db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        reversesId: expenses.reversesId,
        monthKey: sql<string>`to_char(date_trunc('month', ${EXPENSE_MONTH}), 'YYYY-MM')`,
      })
      .from(expenses),
  ]);

  const incomeByMonth = sumByMonth(
    incomeRows.map((row) => ({ monthKey: row.monthKey, cents: Number(row.cents) })),
  );
  const supplierByMonth = sumByMonth(
    supplierRows.map((row) => ({ monthKey: row.monthKey, cents: Number(row.cents) })),
  );
  const expensesByMonth = new Map<
    string,
    { id: string; amountCents: number; reversesId: string | null }[]
  >();
  for (const row of expenseRows) {
    const list = expensesByMonth.get(row.monthKey) ?? [];
    list.push({ id: row.id, amountCents: toCents(row.amount), reversesId: row.reversesId });
    expensesByMonth.set(row.monthKey, list);
  }

  const keys = new Set([
    ...incomeByMonth.keys(),
    ...supplierByMonth.keys(),
    ...expensesByMonth.keys(),
  ]);
  const months: BooksMonth[] = [...keys]
    .sort()
    .reverse()
    .map((key) => {
      const income = incomeByMonth.get(key) ?? 0;
      const out =
        (supplierByMonth.get(key) ?? 0) + netExpenseCents(expensesByMonth.get(key) ?? []);
      return {
        key,
        label: labelFor(key),
        incomeCents: income,
        outCents: out,
        profitCents: profitCents(income, out),
      };
    });

  const inYear = months.filter((month) => month.key.startsWith(yearPrefix));
  const yearToDateIncomeCents = inYear.reduce((sum, month) => sum + month.incomeCents, 0);
  const yearToDateOutCents = inYear.reduce((sum, month) => sum + month.outCents, 0);

  return {
    yearToDateIncomeCents,
    yearToDateOutCents,
    yearToDateProfitCents: profitCents(yearToDateIncomeCents, yearToDateOutCents),
    months,
  };
}

export interface BooksMonthLine {
  id: string;
  label: string;
  cents: number;
  /** Where the drill-through link goes: job, supplier, or expense anchor. */
  href: string;
  /** Set on correction rows so the UI can badge them. */
  reversesId: string | null;
}

export interface BooksMonthDetail {
  income: BooksMonthLine[];
  supplier: BooksMonthLine[];
  expenses: BooksMonthLine[];
}

/** Fetched only when a month is actually expanded — never on initial page load. */
export async function getBooksMonthDetail(monthKey: string): Promise<BooksMonthDetail> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return { income: [], supplier: [], expenses: [] };

  const [income, supplier, expenseLines] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        jobId: invoices.jobId,
        jobNumber: jobs.jobNumber,
        customerName: jobs.customerName,
        receivedCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(
        and(
          LIVE_INVOICE,
          sql`to_char(date_trunc('month', ${INCOME_MONTH}), 'YYYY-MM') = ${monthKey}`,
        ),
      )
      .groupBy(invoices.id, jobs.id)
      .orderBy(INCOME_MONTH),
    db
      .select({
        id: supplierLedger.id,
        supplierId: supplierLedger.supplierId,
        reference: supplierLedger.reference,
        notes: supplierLedger.notes,
        amount: supplierLedger.amount,
      })
      .from(supplierLedger)
      .where(
        and(
          eq(supplierLedger.kind, 'charge'),
          sql`to_char(date_trunc('month', ${SUPPLIER_MONTH}), 'YYYY-MM') = ${monthKey}`,
        ),
      )
      .orderBy(SUPPLIER_MONTH),
    db
      .select({
        id: expenses.id,
        category: expenses.category,
        note: expenses.note,
        amount: expenses.amount,
        reversesId: expenses.reversesId,
      })
      .from(expenses)
      .where(sql`to_char(date_trunc('month', ${EXPENSE_MONTH}), 'YYYY-MM') = ${monthKey}`)
      .orderBy(EXPENSE_MONTH),
  ]);

  return {
    income: income.map((row) => ({
      id: row.id,
      label: `${row.jobNumber} — ${row.customerName} (${row.invoiceNumber})`,
      cents: Number(row.receivedCents),
      href: `/jobs/${row.jobId}`,
      reversesId: null,
    })),
    supplier: supplier.map((row) => ({
      id: row.id,
      label: row.reference ?? row.notes ?? 'Supplier charge',
      cents: toCents(row.amount),
      href: `/suppliers/${row.supplierId}`,
      reversesId: null,
    })),
    expenses: expenseLines.map((row) => ({
      id: row.id,
      label: `${row.category}${row.note ? ` — ${row.note}` : ''}`,
      cents: toCents(row.amount),
      href: `/earnings#expense-${row.id}`,
      reversesId: row.reversesId,
    })),
  };
}
