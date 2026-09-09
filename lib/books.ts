/**
 * Pure P&L arithmetic for the Books page. Deliberately DB-free so it can be
 * unit-tested on fixed fixtures: the queries in `lib/db/queries/books.ts`
 * fetch rows, everything below turns rows into numbers.
 *
 * All amounts are integer cents. Reversal rows carry the same positive amount
 * as their original and cancel it via `reversesId`.
 */

/** Bucket a `YYYY-MM-DD` date to its `YYYY-MM` month key. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export interface ExpenseMathLine {
  id: string;
  amountCents: number;
  reversesId: string | null;
}

/**
 * Net a month's expense lines: plain rows add, a reversal row subtracts its
 * original's amount. An orphan reversal (target absent from this month's
 * lines) contributes nothing rather than going negative.
 */
export function netExpenseCents(lines: ExpenseMathLine[]): number {
  const byId = new Map(lines.map((line) => [line.id, line.amountCents]));
  let total = 0;
  for (const line of lines) {
    if (line.reversesId === null) {
      total += line.amountCents;
    } else if (byId.has(line.reversesId)) {
      total -= line.amountCents;
    }
  }
  return total;
}

/** Profit is income minus outgoings. Negative means a loss-making month. */
export function profitCents(incomeCents: number, outCents: number): number {
  return incomeCents - outCents;
}
