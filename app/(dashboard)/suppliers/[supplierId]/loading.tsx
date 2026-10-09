import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonTable,
} from '@/components/ui/skeleton';

/**
 * One supplier account: the balance card with its two buttons, then the
 * history table.
 *
 * The heights are taken from the real page rather than guessed — the balance
 * figure is `text-3xl` (h-9), the two lines around it `text-xs` (h-3), and the
 * buttons are `size="sm"` (h-8) — so the card does not resize under the reader
 * the moment the data lands.
 */
export default function SupplierLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading supplier" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-52 max-w-[60vw]" />
          <Skeleton className="h-5 w-40 max-w-[50vw]" />
        </div>
        <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-20" />
            {/* text-3xl is a 36px line box. */}
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-3 w-44 max-w-[60vw]" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <SkeletonCardHeader />
        <SkeletonTable columns={6} rows={5} rightColumns={[2, 3, 4]} lastColumnRight />
      </Card>
    </div>
  );
}
