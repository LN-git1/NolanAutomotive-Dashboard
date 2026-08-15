import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, Card, CardBody, CardHeader, Empty, LinkButton } from '@/components/ui';
import {
  MONTH_NAMES,
  buildMonthGrid,
  listScheduledJobs,
  listUnscheduledJobs,
  monthGridRange,
  resolveMonth,
  shiftMonth,
  todayIso,
} from '@/lib/db/queries/schedule';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Schedule' };
export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * How busy a day looks at a glance. Deliberately coarse — the point is to see
 * where there is room to book someone in, not to model capacity precisely.
 */
function workload(count: number): { label: string; className: string } {
  if (count === 0) return { label: 'Free', className: 'text-muted' };
  if (count <= 2) return { label: `${count} booked`, className: 'text-ok' };
  if (count <= 4) return { label: `${count} booked`, className: 'text-warn' };
  return { label: `${count} booked`, className: 'text-danger' };
}

function JobChip({ job }: { job: Job }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="block truncate rounded border border-line bg-canvas px-1.5 py-1 text-[11px] leading-tight hover:bg-info-soft"
      title={`${job.jobNumber} — ${job.customerName} (${job.vehicleRegistration})`}
    >
      <span className="font-medium text-ink">{job.jobNumber}</span>{' '}
      <span className="text-muted">{job.customerName}</span>
    </Link>
  );
}

export default async function SchedulePage({ searchParams }: PageProps<'/schedule'>) {
  const params = await searchParams;
  const { year, month } = resolveMonth(
    typeof params.year === 'string' ? params.year : undefined,
    typeof params.month === 'string' ? params.month : undefined,
  );

  const { from, to } = monthGridRange(year, month);
  const [scheduled, unscheduled] = await Promise.all([
    listScheduledJobs(from, to),
    listUnscheduledJobs(),
  ]);

  // Bucket by date once, rather than filtering the list inside every cell.
  const byDate = new Map<string, Job[]>();
  for (const job of scheduled) {
    if (!job.dueDate) continue;
    const list = byDate.get(job.dueDate) ?? [];
    list.push(job);
    byDate.set(job.dueDate, list);
  }

  const cells = buildMonthGrid(year, month, byDate);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const today = todayIso();

  // Agenda view (mobile): only days that actually have work, from today on.
  const agenda = cells
    .filter((cell) => cell.jobs.length > 0 && cell.date >= today)
    .slice(0, 30);

  const bookedThisMonth = cells.filter((c) => c.inCurrentMonth).reduce((n, c) => n + c.jobs.length, 0);
  const freeDaysThisMonth = cells.filter(
    (c) => c.inCurrentMonth && !c.isWeekend && c.jobs.length === 0,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Schedule</h1>
          <p className="text-sm text-muted">
            {bookedThisMonth} {bookedThisMonth === 1 ? 'job' : 'jobs'} booked this month ·{' '}
            {freeDaysThisMonth} free weekday{freeDaysThisMonth === 1 ? '' : 's'}
          </p>
        </div>
        <LinkButton href="/jobs/new">New job</LinkButton>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <Link
            href={`/schedule?year=${prev.year}&month=${prev.month}`}
            aria-label="Previous month"
            className="rounded-md border border-line p-2 hover:bg-canvas"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>

          <div className="text-center">
            <p className="text-sm font-semibold text-ink">
              {MONTH_NAMES[month]} {year}
            </p>
            <Link href="/schedule" className="text-xs text-brand-dark hover:underline">
              Today
            </Link>
          </div>

          <Link
            href={`/schedule?year=${next.year}&month=${next.month}`}
            aria-label="Next month"
            className="rounded-md border border-line p-2 hover:bg-canvas"
          >
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>

        {/* Month grid — from md up, where seven columns are actually readable. */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-2 text-center text-xs font-semibold text-muted">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const load = workload(cell.jobs.length);
              return (
                <div
                  key={cell.date}
                  className={cn(
                    'min-h-28 border-r border-b border-line p-1.5 last:border-r-0',
                    !cell.inCurrentMonth && 'bg-canvas/60',
                    cell.isWeekend && cell.inCurrentMonth && 'bg-canvas/40',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs',
                        cell.isToday && 'bg-brand font-semibold text-white',
                        !cell.isToday && cell.inCurrentMonth && 'text-ink',
                        !cell.inCurrentMonth && 'text-muted',
                      )}
                    >
                      {cell.dayOfMonth}
                    </span>
                    {cell.inCurrentMonth && cell.jobs.length > 0 ? (
                      <span className={cn('text-[10px]', load.className)}>{cell.jobs.length}</span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1">
                    {cell.jobs.slice(0, 3).map((job) => (
                      <JobChip key={job.id} job={job} />
                    ))}
                    {cell.jobs.length > 3 ? (
                      <span className="px-1 text-[10px] text-muted">
                        +{cell.jobs.length - 3} more
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agenda — phones. A seven-column grid is unusable at that width. */}
        <div className="md:hidden">
          {agenda.length === 0 ? (
            <Empty>Nothing booked from today onwards this month.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {agenda.map((cell) => (
                <li key={cell.date} className="px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn('text-sm font-semibold', cell.isToday ? 'text-brand-dark' : 'text-ink')}>
                      {cell.isToday ? 'Today · ' : ''}
                      {formatDate(cell.date)}
                    </span>
                    <span className={cn('text-xs', workload(cell.jobs.length).className)}>
                      {workload(cell.jobs.length).label}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {cell.jobs.map((job) => (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">
                            {job.jobNumber} — {job.customerName}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {job.vehicleRegistration}
                          </span>
                        </span>
                        <Badge value={job.status} />
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Not booked in yet"
          description="Live jobs with no date — give them one so they show on the calendar"
        />
        {unscheduled.length === 0 ? (
          <Empty>Every live job has a date.</Empty>
        ) : (
          <CardBody className="flex flex-col gap-2">
            {unscheduled.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {job.jobNumber} — {job.customerName}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {job.vehicleRegistration}
                    {job.vehicleMake ? ` · ${job.vehicleMake} ${job.vehicleModel ?? ''}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge value={job.priority} />
                  <Badge value={job.status} />
                </span>
              </Link>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
