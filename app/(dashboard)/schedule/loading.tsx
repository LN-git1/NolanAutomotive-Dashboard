import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonPageHeader,
  SkeletonScheduleHeader,
} from '@/components/ui/skeleton';

/**
 * Schedule.
 *
 * The month grid is the one placeholder worth building properly: it is a fixed
 * 7-column, 6-row calendar whose height does not depend on the data, so the
 * skeleton can match it exactly. Anything vaguer would visibly resize when the
 * real month arrives.
 *
 * The grid renders at every width — phones included — with the day-detail
 * panel above it, so the skeleton does the same: panel first, then grid, then
 * the "not booked in yet" list. Cell heights follow the real tiers
 * (`min-h-20 sm:min-h-24 md:min-h-28`).
 */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading the schedule" />
      <SkeletonPageHeader action />

      <Card>
        <div className="border-b border-line px-4 py-3">
          <SkeletonScheduleHeader />
        </div>

        {/* Day detail panel — header row plus two job detail cards. */}
        <div className="border-b border-line p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line p-3">
                <Skeleton className="h-3.5 w-40 max-w-[70vw]" />
                <Skeleton className="h-3 w-56 max-w-[80vw]" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        </div>

        {/* Month grid, every width. */}
        <div>
          <div className="grid grid-cols-7 border-b border-line">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="px-1 py-2 text-center sm:px-2">
                <Skeleton className="mx-auto h-3 w-6" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }).map((_, i) => (
              <div
                key={i}
                className="min-h-20 border-r border-b border-line p-1.5 last:border-r-0 sm:min-h-24 md:min-h-28"
              >
                <Skeleton className="h-3 w-4" />
                {/* Only some days carry a job; a placeholder on every cell would
                    read as a fully booked month. */}
                {i % 5 === 2 ? <Skeleton className="mt-2 h-4 w-full" /> : null}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Not booked in yet — two-line bordered rows, matching the real links. */}
      <Card>
        <CardBody className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
            >
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48 max-w-[60vw]" />
              </div>
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
