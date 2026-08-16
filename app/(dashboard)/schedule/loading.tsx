import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonPageHeader,
} from '@/components/ui/skeleton';

/**
 * Schedule.
 *
 * The month grid is the one placeholder worth building properly: it is a fixed
 * 7-column, 6-row calendar whose height does not depend on the data, so the
 * skeleton can match it exactly. Anything vaguer would visibly resize when the
 * real month arrives.
 *
 * The grid is hidden below `md` because the page itself swaps to an agenda list
 * on phones — mirroring that means the phone never renders a calendar skeleton
 * for a calendar it is not about to show.
 */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading the schedule" />
      <SkeletonPageHeader action />

      <Card>
        <SkeletonCardHeader description action />

        {/* Month grid, md and up. */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 border-b border-line">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="px-2 py-2">
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }).map((_, i) => (
              <div key={i} className="min-h-24 border-r border-b border-line p-2 last:border-r-0">
                <Skeleton className="h-3 w-4" />
                {/* Only some days carry a job; a placeholder on every cell would
                    read as a fully booked month. */}
                {i % 5 === 2 ? <Skeleton className="mt-2 h-4 w-full" /> : null}
              </div>
            ))}
          </div>
        </div>

        {/* Agenda list, phones. */}
        <div className="flex flex-col divide-y divide-line md:hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-48 max-w-[70vw]" />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full max-w-md" />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
