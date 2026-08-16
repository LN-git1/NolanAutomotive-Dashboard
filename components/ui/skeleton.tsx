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

/** A line of text. Widths vary so a stack reads as prose, not as a barcode. */
export function SkeletonText({
  width = 'w-full',
  className,
}: {
  width?: string;
  className?: string;
}) {
  return <Skeleton className={cn('h-3.5', width, className)} />;
}

/* --------------------------------------------------------------- page head */

/** The `h1` + subtitle every page opens with, optionally with an action button. */
export function SkeletonPageHeader({ action = false }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-64 max-w-[70vw]" />
      </div>
      {action ? <Skeleton className="h-9 w-28 rounded-md" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ tables */

/**
 * A table placeholder that matches `Table`/`Th`/`Td` exactly — same
 * `min-w-[36rem]`, same `px-3 py-2`, same bottom borders — so the switch to
 * real rows moves nothing.
 *
 * `lastColumnRight` mirrors the money/action columns that are right-aligned.
 */
export function SkeletonTable({
  columns,
  rows = 5,
  lastColumnRight = false,
}: {
  columns: number;
  rows?: number;
  lastColumnRight?: boolean;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="border-b border-line px-3 py-2 text-left">
                <Skeleton
                  className={cn(
                    'h-3 w-16',
                    lastColumnRight && i === columns - 1 && 'ml-auto',
                  )}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex} className="border-b border-line px-3 py-2 align-top">
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
                        lastColumnRight && colIndex === columns - 1 && 'ml-auto',
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

/** A card wrapping a table, with the header bar above it. */
export function SkeletonTableCard({
  columns,
  rows = 5,
  lastColumnRight = false,
  description = false,
}: {
  columns: number;
  rows?: number;
  lastColumnRight?: boolean;
  description?: boolean;
}) {
  return (
    <Card>
      <SkeletonCardHeader description={description} />
      <SkeletonTable columns={columns} rows={rows} lastColumnRight={lastColumnRight} />
    </Card>
  );
}

/** Mirrors `CardHeader`: same border, same `px-4 py-3`. */
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
        <Skeleton className="h-3.5 w-32" />
        {description ? <Skeleton className="h-3 w-44 max-w-[60vw]" /> : null}
      </div>
      {action ? <Skeleton className="h-8 w-24 rounded-md" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- tiles */

/** One figure in a stat grid: small label above, large number below. */
export function SkeletonStatTile() {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-16" />
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

/** A block of fields inside a card, matching the two-column form grids. */
export function SkeletonFormCard({
  fields = 4,
  columns = 2,
  description = false,
}: {
  fields?: number;
  columns?: 1 | 2 | 3;
  description?: boolean;
}) {
  return (
    <Card>
      <SkeletonCardHeader description={description} />
      <div
        className={cn(
          'grid grid-cols-1 gap-4 p-4',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-3',
        )}
      >
        {Array.from({ length: fields }).map((_, i) => (
          <SkeletonField key={i} />
        ))}
      </div>
    </Card>
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
