import type { ComponentProps } from 'react';

import { Card, CardBody } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders.
 *
 * Two rules govern everything in this file:
 *
 *  1. **A skeleton must occupy the same space as the content it stands in for.**
 *     A placeholder that is the wrong height causes the exact layout shift it
 *     exists to prevent — the page settles, the owner's thumb is already moving,
 *     and they tap the wrong row. Every block below is built from the same
 *     markup as its real counterpart, so the rows, padding and borders line up.
 *
 *  2. **Server-rendered, never client state.** These render inside `loading.tsx`,
 *     which Next.js streams instantly while the page's data is still being
 *     fetched. No hook, no effect, no hydration — the placeholder is in the very
 *     first byte of HTML.
 *
 * They are decorative: `aria-hidden` on the shapes, with one polite live region
 * per screen announcing that content is loading, so a screen reader hears one
 * sentence instead of forty empty boxes.
 */

/** The atom. `.skeleton` carries the fill and the sheen; see globals.css. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}

/**
 * Announce loading once per screen. Visually hidden, `polite` so it waits for a
 * pause rather than interrupting, and `busy` so assistive tech knows the region
 * is still settling.
 */
export function LoadingAnnouncement({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" aria-busy="true" className="visually-hidden">
      {label}
    </p>
  );
}

/* --------------------------------------------------------------- page head */

/**
 * The `h1` + subtitle every page opens with, optionally with an action button.
 *
 * Bar heights are the real line boxes, not eyeballed: `text-lg` is a 28px line
 * (`h-7`), `text-sm` is 20px (`h-5`).
 */
export function SkeletonPageHeader({ action = false }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-64 max-w-[70vw]" />
      </div>
      {action ? <Skeleton className="h-9 w-28 rounded-md" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ tables */

/**
 * A table placeholder that matches `Table`/`Th`/`Td` exactly — same `rtable`
 * behaviour, same `sm:min-w-[36rem]`, same `px-3 py-2`, same bottom borders —
 * so the switch to real rows moves nothing.
 *
 * `lastColumnRight` mirrors a single right-aligned money/action column;
 * `rightColumns` lists any others by zero-based index (e.g. Awaiting Payments'
 * "Owed", the supplier detail's Added/Paid-off/Balance).
 *
 * Every cell carries a blank `data-label` so that below `sm` — where `.rtable`
 * turns rows into labelled cards — the skeleton rows become cards too instead
 * of a 576px horizontal scroller that then snaps into cards on load.
 */
export function SkeletonTable({
  columns,
  rows = 5,
  lastColumnRight = false,
  rightColumns = [],
}: {
  columns: number;
  rows?: number;
  lastColumnRight?: boolean;
  rightColumns?: number[];
}) {
  const rightAligned = (index: number) =>
    (lastColumnRight && index === columns - 1) || rightColumns.includes(index);

  return (
    <div className="w-full overflow-x-auto">
      <table className="rtable w-full border-collapse text-sm sm:min-w-[36rem]">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="border-b border-line px-3 py-2 text-left">
                <Skeleton className={cn('h-3 w-16', rightAligned(i) && 'ml-auto')} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td
                  key={colIndex}
                  data-label=" "
                  className="border-b border-line px-3 py-2 align-top"
                >
                  {colIndex === 0 ? (
                    // First column carries two lines in every table in this app
                    // (job number + customer, supplier + note), so it is taller.
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ) : (
                    <Skeleton
                      className={cn(
                        'h-3.5',
                        colIndex % 2 === 0 ? 'w-20' : 'w-14',
                        rightAligned(colIndex) && 'ml-auto',
                      )}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mirrors a closed `CollapsibleCard`: the whole card is just its summary row.
 *
 * The heights are derived, not eyeballed. The real summary is `px-4 py-3`
 * (24px) around a chevron and a two-line stack whose height comes from the text
 * itself — `text-sm` is a 20px line box, `text-xs` a 16px one. So each bar is
 * centred inside a wrapper of that exact height rather than being that height,
 * which keeps the bars thin while the card still lands on the same 60px the
 * real one occupies. Without this the route skeleton drew full tables and the
 * page snapped up by several hundred pixels once it loaded.
 */
export function SkeletonCollapsibleCard() {
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3">
        <Skeleton className="size-4 shrink-0 rounded" />
        <div className="min-w-0 flex-1">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-44 max-w-[60vw]" />
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Mirrors `CardHeader`: same border, same `px-4 py-3`. Title is `text-sm`
 * (20px → `h-5`), description is `text-xs` under `mt-0.5` (`h-4`).
 */
export function SkeletonCardHeader({
  description = false,
  action = false,
}: {
  description?: boolean;
  action?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-32" />
        {description ? <Skeleton className="h-4 w-44 max-w-[60vw]" /> : null}
      </div>
      {action ? <Skeleton className="h-8 w-24 rounded-md" /> : null}
    </div>
  );
}

/**
 * Mirrors the schedule's month navigation: Previous button, centred
 * month + Today, Next button (`schedule/page.tsx` header).
 */
export function SkeletonScheduleHeader() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-7 w-16 rounded-md" />
      </div>
      <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
    </div>
  );
}

/* ------------------------------------------------------------------- tiles */

/**
 * One figure in a stat grid: small label above, large number below, hint line.
 *
 * Real KPI tiles are three lines (`text-xs` label, `text-2xl` value, `text-xs`
 * hint): 16 + 32 + 16 plus the gaps and `p-4`. The value bar is `h-8` because
 * `text-2xl` is a 32px line box — `h-6` left every tile ~28px short.
 */
export function SkeletonStatTile() {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      </CardBody>
    </Card>
  );
}

export function SkeletonStatGrid({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatTile key={i} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- form */

/** A labelled control: the `text-xs` label, then the input itself. */
export function SkeletonField({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Skeleton className="h-3 w-24" />
      {/* h-9 is the height of Input/Select in the UI kit. */}
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

/**
 * A labelled multi-line control, matching `Textarea` (`min-h-20`, `rows={2}`
 * on the notes/address fields throughout the app).
 */
export function SkeletonTextarea({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-20 w-full rounded-md" />
    </div>
  );
}

/** The collapsed `<details>` sections on the job form — header bar only. */
export function SkeletonCollapsedSection() {
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Skeleton className="size-4 rounded" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-48 max-w-[55vw]" />
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- lists */

/** A stack of rows inside a card body — used for lists that are not tables. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40 max-w-[50vw]" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * One collapsed accordion row: label on the left, amount + chevron on the
 * right. Mirrors the Books month rows and the vehicle-history disclosure
 * summaries (`px-4 py-3`, label + right-aligned figure).
 */
export function SkeletonAccordionRow() {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <Skeleton className="h-3.5 w-32" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="size-4 rounded" />
      </div>
    </div>
  );
}
