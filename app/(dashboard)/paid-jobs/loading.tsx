import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonField,
  SkeletonPageHeader,
  SkeletonTable,
} from '@/components/ui/skeleton';

/**
 * Paid jobs: header with the "Open jobs" action, the search bar, the
 * total-collected banner, then the table. Six columns, matching Job / Customer
 * / Vehicle / Invoice / Paid on / Total.
 */
export default function PaidJobsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading paid jobs" />
      <SkeletonPageHeader action />

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <SkeletonField className="min-w-56 flex-1" />
        </div>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-3 w-44" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <SkeletonTable columns={6} rows={8} lastColumnRight />
      </Card>
    </div>
  );
}
