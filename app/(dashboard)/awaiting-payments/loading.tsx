import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonPageHeader,
  SkeletonTable,
} from '@/components/ui/skeleton';

/** Awaiting payments: the total-owed banner, then the invoice table. */
export default function AwaitingPaymentsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading awaiting payments" />
      <SkeletonPageHeader />

      <Card>
        <CardBody>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-36" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <SkeletonCardHeader />
        <SkeletonTable columns={6} rows={5} lastColumnRight />
      </Card>
    </div>
  );
}
