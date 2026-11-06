import 'server-only';

import { and, asc, isNull, lt, ne, sql, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';

import type { MorningFacts } from './payload';

/**
 * What the 9am summary says: how many jobs are booked in for today, which ones,
 * and how many are overdue. `today` is a Dublin date (`YYYY-MM-DD`).
 *
 * A job's `dueDate` is the day it is booked in for. Paid jobs are finished
 * business and are left out of today's list; overdue is the same definition the
 * activity email uses (past its date, and not yet invoiced or paid).
 */
export async function collectMorningFacts(today: string): Promise<MorningFacts> {
  const [todays, overdueRows] = await Promise.all([
    db
      .select({ jobNumber: jobs.jobNumber })
      .from(jobs)
      .where(and(isNull(jobs.deletedAt), eq(jobs.dueDate, today), ne(jobs.status, 'paid')))
      .orderBy(asc(jobs.dueTime), asc(jobs.jobNumber)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(
        and(
          isNull(jobs.deletedAt),
          lt(jobs.dueDate, today),
          ne(jobs.status, 'paid'),
          ne(jobs.status, 'invoiced'),
        ),
      ),
  ]);

  return {
    bookedToday: todays.length,
    overdue: overdueRows[0]?.n ?? 0,
    jobNumbers: todays.map((row) => row.jobNumber),
  };
}
