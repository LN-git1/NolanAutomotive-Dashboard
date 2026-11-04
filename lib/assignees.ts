/**
 * Splitting a job's money between the people who worked on it.
 *
 * Pure and dependency-free so it can be tested without a database.
 */

/** Bucket key for money on jobs nobody is assigned to. */
export const UNASSIGNED = 'unassigned' as const;

/**
 * Split `cents` equally across `ids`. Always sums back to exactly `cents`: when
 * it does not divide evenly the leftover cents go one each to the first people
 * in the list, so the per-person figures can never drift from the real total.
 * An empty list credits the single `UNASSIGNED` bucket.
 */
export function splitCents(cents: number, ids: readonly string[]): Map<string, number> {
  const shares = new Map<string, number>();
  if (ids.length === 0) {
    shares.set(UNASSIGNED, cents);
    return shares;
  }

  const base = Math.trunc(cents / ids.length);
  let remainder = cents - base * ids.length;
  // Negative money (a refund) hands out the leftover as -1 cents.
  const step = remainder < 0 ? -1 : 1;

  for (const id of ids) {
    const extra = remainder !== 0 ? step : 0;
    remainder -= extra;
    shares.set(id, (shares.get(id) ?? 0) + base + extra);
  }
  return shares;
}

export interface JobMoney {
  monthKey: string;
  cents: number;
  /** Everyone credited on the job. Empty = unassigned. */
  assigneeIds: readonly string[];
}

/** `monthKey -> assigneeId (or UNASSIGNED) -> cents`. */
export function creditByMonth(jobs: readonly JobMoney[]): Map<string, Map<string, number>> {
  const months = new Map<string, Map<string, number>>();

  for (const job of jobs) {
    const month = months.get(job.monthKey) ?? new Map<string, number>();
    for (const [id, cents] of splitCents(job.cents, [...job.assigneeIds].sort())) {
      month.set(id, (month.get(id) ?? 0) + cents);
    }
    months.set(job.monthKey, month);
  }
  return months;
}
