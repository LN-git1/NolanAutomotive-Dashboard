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
import { listTimeOffInRange, timeOffDateMap } from '@/lib/db/queries/time-off';
import { formatDate, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/db/schema';

const MONTH_SHORT = MONTH_NAMES.map((name) => name.slice(0, 3));

/** "2026-08-20" -> "20 Aug", for the compact header summary. */
function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1]}`;
}

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

/** Make + model, e.g. "Toyota Corolla" — empty when neither is on the job. */
function vehicleDescription(job: Job): string {
  return [job.vehicleMake, job.vehicleModel].filter(Boolean).join(' ');
}

function JobChip({ job, className }: { job: Job; className?: string }) {
  const time = formatTime(job.dueTime);
  const vehicle = vehicleDescription(job);
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        'block truncate rounded border border-line bg-canvas px-1.5 py-1 text-[11px] leading-tight hover:bg-info-soft',
        className,
      )}
      title={`${time ? `${time} — ` : ''}${job.jobNumber} — ${job.customerName} (${job.vehicleRegistration}${vehicle ? `, ${vehicle}` : ''})`}
    >
      {time ? <span className="text-muted">{time}</span> : null}{' '}
      <span className="font-medium text-ink">{job.jobNumber}</span>{' '}
      <span className="text-muted">{job.customerName}</span>
    </Link>
  );
}

/** Full detail for one job — make/model and the work list, not just a chip's job number. */
function JobDetailCard({ job }: { job: Job }) {
  const time = formatTime(job.dueTime);
  const vehicle = vehicleDescription(job);
  const work = job.labourLines.map((line) => line.description).filter(Boolean);
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 hover:bg-canvas"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-ink">
          {time ? `${time} · ` : ''}
          {job.jobNumber} — {job.customerName}
        </span>
        <Badge value={job.status} />
      </div>
      <span className="truncate text-xs text-muted">
        {job.vehicleRegistration}
        {vehicle ? ` · ${vehicle}` : ''}
      </span>
      {work.length > 0 ? (
        <ul className="mt-0.5 list-disc pl-4 text-xs text-muted">
          {work.map((description, i) => (
            <li key={i} className="truncate">
              {description}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs italic text-muted">No work items added yet.</span>
      )}
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
  const [scheduled, unscheduled, timeOffEntries] = await Promise.all([
    listScheduledJobs(from, to),
    listUnscheduledJobs(),
    listTimeOffInRange(from, to),
  ]);

  // Bucket by date once, rather than filtering the list inside every cell.
  // `scheduled` already arrives ordered soonest-first (by date, then time,
  // then job number), so each day's bucket comes out chronological for free.
  const byDate = new Map<string, Job[]>();
  for (const job of scheduled) {
    if (!job.dueDate) continue;
    const list = byDate.get(job.dueDate) ?? [];
    list.push(job);
    byDate.set(job.dueDate, list);
  }

  const cells = buildMonthGrid(year, month, byDate, timeOffDateMap(timeOffEntries, from, to));
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const today = todayIso();

  // Selected day, driving the detail panel below the grid — a tap target for
  // mobile (the grid cells are too narrow to show a job's full detail inline)
  // that also gives desktop a single place to read make/model + work items
  // without cramming them into a chip. Only trusted when it actually falls
  // within the month currently on screen.
  const dayParam = typeof params.day === 'string' ? params.day : undefined;
  const selectedDate = dayParam && cells.some((c) => c.date === dayParam) ? dayParam : undefined;
  const selectedCell = selectedDate ? cells.find((c) => c.date === selectedDate) : undefined;

  // With no day picked, the panel falls back to an agenda of what's coming up
  // rather than going blank — this is the view that used to be mobile's only
  // way to see the schedule, and losing it would be a real regression for the
  // ~90% of use that happens on a phone. Capped the same way it always was.
  const agenda = cells.filter((cell) => cell.jobs.length > 0 && cell.date >= today).slice(0, 30);

  const dayHref = (date: string) => `/schedule?year=${year}&month=${month}&day=${date}`;
  const now = new Date();
  const todayHref = `/schedule?year=${now.getFullYear()}&month=${now.getMonth()}&day=${today}`;

  const bookedThisMonth = cells.filter((c) => c.inCurrentMonth).reduce((n, c) => n + c.jobs.length, 0);

  // Time off overlapping the actual month (not the grid's padding days either
  // side of it) — a short, honest mention rather than a "free days" count
  // that would need to reconcile weekends being bookable with time-off days
  // not being. See CHANGELOG for why that count was removed outright.
  const monthFrom = cells.find((c) => c.inCurrentMonth)?.date ?? from;
  const monthTo = [...cells].reverse().find((c) => c.inCurrentMonth)?.date ?? to;
  const timeOffThisMonth = timeOffEntries.filter(
    (entry) => entry.startDate <= monthTo && entry.endDate >= monthFrom,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Schedule</h1>
          <p className="text-sm text-muted">
            {bookedThisMonth} {bookedThisMonth === 1 ? 'job' : 'jobs'} booked this month
            {timeOffThisMonth.length > 0 ? (
              <>
                {' '}
                ·{' '}
                {timeOffThisMonth
                  .map((entry) => {
                    const range =
                      entry.startDate === entry.endDate
                        ? formatShortDate(entry.startDate)
                        : `${formatShortDate(entry.startDate)} – ${formatShortDate(entry.endDate)}`;
                    return entry.label ? `Off ${range} (${entry.label})` : `Off ${range}`;
                  })
                  .join(', ')}
              </>
            ) : null}
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
            <Link href={todayHref} className="text-xs text-brand-dark hover:underline">
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

        {/* Month grid — every screen size now, phones included. Cells stay
            narrow on mobile (a chip's full text won't fit seven-across), so
            each one is a tap target for the day-detail panel below rather
            than trying to cram job text into ~45px of width. */}
        <div>
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-1 py-2 text-center text-xs font-semibold text-muted sm:px-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const timeOff = cell.isTimeOff && cell.inCurrentMonth;
              const isSelected = cell.date === selectedDate;
              return (
                <div
                  key={cell.date}
                  className={cn(
                    'relative min-h-20 border-r border-b border-line p-1.5 last:border-r-0 sm:min-h-24 md:min-h-28',
                    !cell.inCurrentMonth && 'bg-canvas/60',
                    cell.isWeekend && cell.inCurrentMonth && !timeOff && !isSelected && 'bg-canvas/40',
                    timeOff && 'bg-warn-soft',
                    isSelected && !timeOff && 'bg-info-soft',
                    isSelected && 'ring-1 ring-inset ring-brand',
                  )}
                >
                  {/* Whole-cell tap target selecting the day, sitting behind the
                      content below — job chips opt back into pointer events so a
                      tap on one still goes straight to the job, not the day. */}
                  <Link
                    href={dayHref(cell.date)}
                    aria-label={`${formatDate(cell.date)}${cell.jobs.length > 0 ? `, ${cell.jobs.length} booked` : ''}`}
                    className="absolute inset-0 hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  />

                  <div className="relative flex flex-col gap-1 pointer-events-none">
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          'inline-flex size-6 items-center justify-center rounded-full text-xs',
                          cell.isToday && 'bg-brand font-semibold text-white',
                          !cell.isToday && cell.inCurrentMonth && 'text-ink',
                          !cell.inCurrentMonth && 'text-muted',
                          timeOff && !cell.isToday && 'text-warn line-through',
                        )}
                      >
                        {cell.dayOfMonth}
                      </span>
                    </div>

                    {timeOff ? (
                      <p className="truncate text-[10px] font-medium text-warn">
                        Off{cell.timeOffLabel ? ` · ${cell.timeOffLabel}` : ''}
                      </p>
                    ) : null}

                    {/* Chips render at every width now — a phone column is too
                        narrow for three, so each cell shows more of them as
                        the column widens: 1 below `sm`, 2 from `sm`, 3 from
                        `md`. The "+N more" count is computed per tier and
                        each version is hidden outside its own breakpoint. */}
                    <div className="flex flex-col gap-1">
                      {cell.jobs.slice(0, 3).map((job, i) => (
                        <JobChip
                          key={job.id}
                          job={job}
                          className={cn(
                            'pointer-events-auto',
                            i === 1 && 'hidden sm:block',
                            i === 2 && 'hidden md:block',
                          )}
                        />
                      ))}
                      {cell.jobs.length > 1 ? (
                        <span className="px-1 text-[10px] text-muted sm:hidden">
                          +{cell.jobs.length - 1} more
                        </span>
                      ) : null}
                      {cell.jobs.length > 2 ? (
                        <span className="hidden px-1 text-[10px] text-muted sm:block md:hidden">
                          +{cell.jobs.length - 2} more
                        </span>
                      ) : null}
                      {cell.jobs.length > 3 ? (
                        <span className="hidden px-1 text-[10px] text-muted md:block">
                          +{cell.jobs.length - 3} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Day detail — the full picture for whichever day is selected above:
            vehicle make/model and the work list, not just a chip's job number.
            Shown at every width, not just mobile, since a grid cell never had
            room for this even on desktop. With no day tapped this falls back
            to an agenda of what's coming up, rather than going blank — that
            agenda used to be mobile's only view of the schedule, and losing it
            outright when adding the grid would cost more than the grid gains. */}
        <div className="border-t border-line p-4">
          {selectedCell ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <Link
                  href={`/schedule?year=${year}&month=${month}`}
                  className="text-xs text-brand-dark hover:underline"
                >
                  ← What&rsquo;s coming up
                </Link>
              </div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className={cn('text-sm font-semibold', selectedCell.isToday ? 'text-brand-dark' : 'text-ink')}>
                  {selectedCell.isToday ? 'Today · ' : ''}
                  {formatDate(selectedCell.date)}
                </span>
                {selectedCell.isTimeOff ? (
                  <span className="text-xs font-medium text-warn">
                    Off{selectedCell.timeOffLabel ? ` · ${selectedCell.timeOffLabel}` : ''}
                  </span>
                ) : (
                  <span className={cn('text-xs', workload(selectedCell.jobs.length).className)}>
                    {workload(selectedCell.jobs.length).label}
                  </span>
                )}
              </div>

              {selectedCell.jobs.length === 0 ? (
                <Empty>Nothing booked in on this day.</Empty>
              ) : (
                <div className="flex flex-col gap-2">
                  {selectedCell.jobs.map((job) => (
                    <JobDetailCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </>
          ) : agenda.length === 0 ? (
            <Empty>Nothing booked from today onwards this month. Tap a date to look elsewhere.</Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {agenda.map((cell) => (
                <div key={cell.date}>
                  <div className="mb-2 flex items-center justify-between">
                    <Link
                      href={dayHref(cell.date)}
                      className={cn(
                        'text-sm font-semibold hover:underline',
                        cell.isToday ? 'text-brand-dark' : 'text-ink',
                      )}
                    >
                      {cell.isToday ? 'Today · ' : ''}
                      {formatDate(cell.date)}
                    </Link>
                    <span className={cn('text-xs', workload(cell.jobs.length).className)}>
                      {workload(cell.jobs.length).label}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {cell.jobs.map((job) => (
                      <JobDetailCard key={job.id} job={job} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
