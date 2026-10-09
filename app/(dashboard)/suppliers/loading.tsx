import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonField,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTextarea,
} from '@/components/ui/skeleton';

/**
 * Owed to others: total banner, then the supplier table beside the add-supplier
 * form. The `xl:grid-cols-[1fr_22rem]` split is copied from the page so the form
 * column does not jump width when the real content arrives.
 */
export default function SuppliersLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading suppliers" />
      <SkeletonPageHeader />

      <Card>
        <CardBody>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            {/* text-2xl is a 32px line box. */}
            <Skeleton className="h-8 w-32" />
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <SkeletonCardHeader />
          <SkeletonTable columns={4} rows={5} rightColumns={[2, 3]} />
        </Card>

        <Card className="order-first xl:order-none">
          <SkeletonCardHeader />
          <div className="flex flex-col gap-4 p-4">
            <SkeletonField />
            <SkeletonTextarea />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </Card>
      </div>
    </div>
  );
}
