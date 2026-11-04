import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { creditByMonth, UNASSIGNED } from '@/lib/assignees';

import { db } from '../index';
import { withDbRetry } from '../retry';
import { assignees, invoices, jobAssignees, jobs, payments } from '../schema';
import { MONTH_NAMES } from './schedule';

/** Everyone still working here, for the job picker. Archived people are excluded. */
export async function listActiveAssignees() {
  return withDbRetry('assignees:active', () =>
    db
      .select()
      .from(assignees)
      .where(isNull(assignees.archivedAt))
      .orderBy(asc(assignees.name)),
  );
}

/** Active people plus how many jobs each has — for the Settings list. */
export async function listAssigneesWithJobCounts() {
  return withDbRetry('assignees:settings', () =>
    db
      .select({
        id: assignees.id,
        name: assignees.name,
        jobCount: sql<number>`COUNT(${jobAssignees.jobId})::int`,
      })
      .from(assignees)
      .leftJoin(jobAssignees, eq(jobAssignees.assigneeId, assignees.id))
      .where(isNull(assignees.archivedAt))
      .groupBy(assignees.id)
      .orderBy(asc(assignees.name)),
  );
}

/**
 * The people already on one job, archived or not. The job form needs the
 * archived ones too: otherwise opening and re-saving an old job would silently
 * drop a former colleague from it.
 */
export async function listJobAssignees(jobId: string) {
  return withDbRetry('assignees:for-job', () =>
    db
      .select({ id: assignees.id, name: assignees.name, archivedAt: assignees.archivedAt })
      .from(jobAssignees)
      .innerJoin(assignees, eq(jobAssignees.assigneeId, assignees.id))
      .where(eq(jobAssignees.jobId, jobId))
      .orderBy(asc(assignees.name)),
  );
}

export interface AssigneeEarning {
  /** An assignee id, or `unassigned`. */
  id: string;
  name: string;
  archived: boolean;
  cents: number;
}

export interface AssigneeEarningsMonth {
  key: string;
  label: string;
  totalCents: number;
  people: AssigneeEarning[];
}

export interface AssigneeEarningsSummary {
  /** Every person with credit this calendar year, biggest first. */
  yearToDate: AssigneeEarning[];
  /** Most recent month first. */
  months: AssigneeEarningsMonth[];
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

/**
 * Cash received, credited to whoever worked the job.
 *
 * Deliberately the same basis as Earnings & Expenses (`books.ts`): payments on
 * live invoices of live jobs, in the month of the job's due date (falling back
 * to the invoice date). That is what makes the per-person figures add up to the
 * "In" figure already on screen. A job with several people splits equally; a job
 * with nobody lands under "Unassigned".
 */
export async function getAssigneeEarnings(): Promise<AssigneeEarningsSummary> {
  const incomeMonth = sql`COALESCE(${jobs.dueDate}, ${invoices.issueDate})`;
  const yearPrefix = `${new Date().getFullYear()}-`;

  const [moneyRows, people] = await withDbRetry('assignees:earnings', () =>
    Promise.all([
      db
        .select({
          jobId: jobs.id,
          monthKey: sql<string>`to_char(date_trunc('month', ${incomeMonth}), 'YYYY-MM')`,
          cents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
        })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(jobs, eq(invoices.jobId, jobs.id))
        .where(and(isNull(invoices.voidedAt), isNull(jobs.deletedAt)))
        .groupBy(jobs.id, sql`date_trunc('month', ${incomeMonth})`),
      db.select().from(assignees),
    ]),
  );

  const jobIds = [...new Set(moneyRows.map((row) => row.jobId))];
  const links =
    jobIds.length === 0
      ? []
      : await withDbRetry('assignees:earnings-links', () =>
          db
            .select({ jobId: jobAssignees.jobId, assigneeId: jobAssignees.assigneeId })
            .from(jobAssignees)
            .where(inArray(jobAssignees.jobId, jobIds)),
        );

  const byJob = new Map<string, string[]>();
  for (const link of links) {
    const list = byJob.get(link.jobId) ?? [];
    list.push(link.assigneeId);
    byJob.set(link.jobId, list);
  }

  const credit = creditByMonth(
    moneyRows.map((row) => ({
      monthKey: row.monthKey,
      cents: Number(row.cents),
      assigneeIds: byJob.get(row.jobId) ?? [],
    })),
  );

  const nameOf = new Map(people.map((person) => [person.id, person]));
  const describe = (id: string, cents: number): AssigneeEarning => {
    if (id === UNASSIGNED) return { id, name: 'Unassigned', archived: false, cents };
    const person = nameOf.get(id);
    return {
      id,
      name: person?.name ?? 'Unknown',
      archived: person?.archivedAt != null,
      cents,
    };
  };
  const biggestFirst = (a: AssigneeEarning, b: AssigneeEarning) =>
    b.cents - a.cents || a.name.localeCompare(b.name);

  const ytd = new Map<string, number>();
  const months: AssigneeEarningsMonth[] = [...credit.keys()]
    .sort()
    .reverse()
    .map((key) => {
      const month = credit.get(key) ?? new Map<string, number>();
      if (key.startsWith(yearPrefix)) {
        for (const [id, cents] of month) ytd.set(id, (ytd.get(id) ?? 0) + cents);
      }
      const list = [...month].map(([id, cents]) => describe(id, cents)).sort(biggestFirst);
      return {
        key,
        label: monthLabel(key),
        totalCents: list.reduce((sum, person) => sum + person.cents, 0),
        people: list,
      };
    });

  return {
    yearToDate: [...ytd].map(([id, cents]) => describe(id, cents)).sort(biggestFirst),
    months,
  };
}
