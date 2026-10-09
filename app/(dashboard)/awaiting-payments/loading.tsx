import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonField,
  SkeletonPageHeader,
  SkeletonTable,
} from '@/components/ui/skeleton';

/**
 * Invoiced jobs: header with the "Workshop jobs" action, the search bar, the
 * total-outstanding banner, then the table. Seven columns, matching Job /
 * Customer / Vehicle / Invoice / Issued / Owed / Action.
 */
export default function InvoicedJobsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading invoiced jobs" />
      <SkeletonPageHeader action />

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <SkeletonField className="min-w-56 flex-1" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-3 w-44" />
          </div>
        </CardBody>
      </Card>

      <Card>
        {/* Owed (index 5) is right-aligned alongside the last Action column. */}
        <SkeletonTable columns={7} rows={5} rightColumns={[5]} lastColumnRight />
      </Card>
    </div>
  );
}
