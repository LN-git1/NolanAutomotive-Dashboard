import 'server-only';

import { and, asc, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { db } from '../index';
import { jobs, type Job } from '../schema';
import { JOB_IS_PRE_INVOICE, JOB_IS_SETTLED } from './invoice-state';

/**
 * Scheduling reads.
 *
 * A job's `dueDate` is the day it is booked in for. Dates are handled as
 * `YYYY-MM-DD` strings throughout rather than `Date` objects — the column is a
 * bare `date` with no time, and converting to a Date introduces a timezone
 * offset that can silently move a booking to the previous or next day.
 */

export interface DayCell {
  /** `YYYY-MM-DD` */
  date: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  isTimeOff: boolean;
  timeOffLabel: string | null;
  jobs: Job[];
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayIso(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Jobs booked into a date range, soonest first. Paid work is history, not
 * schedule. Within a day, timed jobs sort by `dueTime` — plain string
 * comparison is correct here because it is always zero-padded "HH:MM", so
 * lexicographic order is chronological order. Postgres's default ASC null
 * ordering (NULLS LAST) puts jobs with no set time after the timed ones on
 * the same day, tie-broken by job number.
 */
export async function listScheduledJobs(fromIso: string, toIso: string) {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        isNotNull(jobs.dueDate),
        gte(jobs.dueDate, fromIso),
        lte(jobs.dueDate, toIso),
      ),
    )
    .orderBy(asc(jobs.dueDate), asc(jobs.dueTime), asc(jobs.jobNumber));
}

/**
 * Live work with no date on it. These are the jobs that would otherwise be
 * invisible on a calendar and quietly forgotten, so the page surfaces them.
 */
export async function listUnscheduledJobs(limit = 25) {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        isNull(jobs.dueDate),
        // Work that has not been billed yet — the same test the Overview's
        // Active tile uses, from the invoices rather than from `jobs.status`.
        // That column is a workflow label the owner can move at any time, and
        // keying scheduling off it is how J-0019 came to be wrong everywhere
        // else; see `invoice-state.ts`.
        JOB_IS_PRE_INVOICE,
      ),
    )
    .orderBy(asc(jobs.createdAt))
    .limit(limit);
}

/** Count of live jobs per day across a range — drives the workload summary. */
export async function countJobsPerDay(fromIso: string, toIso: string) {
  const rows = await db
    .select({
      day: jobs.dueDate,
      n: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        isNotNull(jobs.dueDate),
        gte(jobs.dueDate, fromIso),
        lte(jobs.dueDate, toIso),
        // Settled work is history, not workload.
        sql`NOT ${JOB_IS_SETTLED}`,
      ),
    )
    .groupBy(jobs.dueDate);

  const counts = new Map<string, number>();
  for (const row of rows) if (row.day) counts.set(row.day, Number(row.n));
  return counts;
}

/**
 * Build a Monday-first month grid, padded with the surrounding days so every
 * row has seven cells. Irish week starts Monday, not Sunday.
 *
 * `timeOffByDate` defaults to empty so existing callers (and tests) that only
 * pass `jobsByDate` keep working unchanged.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  jobsByDate: Map<string, Job[]>,
  timeOffByDate: Map<string, string | null> = new Map(),
): DayCell[] {
  const today = todayIso();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // getUTCDay(): 0 = Sunday. Shift so Monday is 0.
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;

  const cells: DayCell[] = [];

  const push = (d: Date, inCurrentMonth: boolean) => {
    const date = isoDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const weekday = d.getUTCDay();
    cells.push({
      date,
      dayOfMonth: d.getUTCDate(),
      inCurrentMonth,
      isToday: date === today,
      isWeekend: weekday === 0 || weekday === 6,
      isTimeOff: timeOffByDate.has(date),
      timeOffLabel: timeOffByDate.get(date) ?? null,
      jobs: jobsByDate.get(date) ?? [],
    });
  };

  for (let i = leading; i > 0; i -= 1) push(new Date(Date.UTC(year, month, 1 - i)), false);
  for (let d = 1; d <= daysInMonth; d += 1) push(new Date(Date.UTC(year, month, d)), true);
  // Pad to a whole number of weeks.
  while (cells.length % 7 !== 0) {
    const next = cells.length - leading - daysInMonth + 1;
    push(new Date(Date.UTC(year, month + 1, next)), false);
  }

  return cells;
}

/** First and last date shown by the grid, so the query covers the padding too. */
export function monthGridRange(year: number, month: number): { from: string; to: string } {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;
  const from = new Date(Date.UTC(year, month, 1 - leading));

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;
  const to = new Date(Date.UTC(year, month, 1 - leading + total - 1));

  return {
    from: isoDate(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    to: isoDate(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  };
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Clamp arbitrary query params to a valid month, defaulting to the current one. */
export function resolveMonth(yearParam?: string, monthParam?: string) {
  const now = new Date();
  const year = Number(yearParam);
  const month = Number(monthParam);

  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : now.getFullYear();
  const validMonth = Number.isInteger(month) && month >= 0 && month <= 11 ? month : now.getMonth();

  return { year: validYear, month: validMonth };
}

/** Previous/next month, handling the year rollover. */
export function shiftMonth(year: number, month: number, by: number) {
  const d = new Date(Date.UTC(year, month + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}
