import { Card } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonField,
  SkeletonStatGrid,
  SkeletonTable,
} from '@/components/ui/skeleton';

/** One supplier: two figures, then the bills table beside the add-bill form. */
export default function SupplierLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading supplier" />

      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-52 max-w-[70vw]" />
        <Skeleton className="h-3.5 w-40" />
      </div>

      <SkeletonStatGrid count={2} className="grid grid-cols-1 gap-3 sm:grid-cols-2" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <SkeletonCardHeader />
          <SkeletonTable columns={5} rows={5} lastColumnRight />
        </Card>

        <Card>
          <SkeletonCardHeader />
          <div className="flex flex-col gap-4 p-4">
            <SkeletonField />
            <SkeletonField />
            <SkeletonField />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </Card>
      </div>
    </div>
  );
}
