import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonPageHeader,
  SkeletonTextarea,
  SkeletonField,
} from '@/components/ui/skeleton';

/**
 * Settings.
 *
 * Mirrors the real page card for card: the form's business-details, VAT,
 * invoicing-defaults and time-format cards with the save button after them,
 * then invoice numbering, time off, data export and the danger zone. An
 * earlier version of this file guessed at uniform field cards and missed whole
 * cards (time format, numbering, time off), which measured as a large jump
 * when the real page landed.
 */
export default function SettingsLoading() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <LoadingAnnouncement label="Loading settings" />
      <SkeletonPageHeader />

      {/* Business details — name, phone, email, then a full-width address. */}
      <Card>
        <SkeletonCardHeader description />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
          <SkeletonTextarea className="sm:col-span-2" />
        </div>
      </Card>

      {/* VAT — a checkbox, then the number and rate. */}
      <Card>
        <SkeletonCardHeader description />
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3.5 w-48 max-w-[60vw]" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SkeletonField />
            <SkeletonField />
          </div>
        </div>
      </Card>

      {/* Invoicing defaults. */}
      <Card>
        <SkeletonCardHeader />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <SkeletonField />
        </div>
      </Card>

      {/* Time format — two large toggle rows. */}
      <Card>
        <SkeletonCardHeader description />
        <div className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-line p-3.5"
              >
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="size-5 rounded-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </Card>

      <div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* Invoice numbering — label, large figure, two explainer lines. */}
      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-full max-w-lg" />
          <Skeleton className="h-3 w-4/5 max-w-md" />
        </CardBody>
      </Card>

      {/* Time off — booked rows with a remove button each, then the add button. */}
      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-40 max-w-[55vw]" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="size-7 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </CardBody>
      </Card>

      {/* Data export — one two-line bordered row per CSV. */}
      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
            >
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-56 max-w-[60vw]" />
              </div>
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Danger zone — the counts grid, then the reveal button. */}
      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-4">
          <div className="rounded-md border border-line bg-canvas p-3">
            <Skeleton className="h-3 w-28" />
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-8" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-9 w-40 rounded-md" />
        </CardBody>
      </Card>
    </div>
  );
}
