import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonAccordionRow,
  SkeletonCardHeader,
  SkeletonField,
  SkeletonPageHeader,
  SkeletonStatGrid,
} from '@/components/ui/skeleton';

/**
 * Earnings & Expenses.
 *
 * Three stat tiles — In and Out side by side, then the full-width Profit card —
 * then the Monthly card with its accordion rows, the Add expense form and the
 * Refresh button. An earlier version of this file showed only the two tiles
 * and a generic list, and missed the profit card, the expense form and the
 * month-row shape entirely.
 */
export default function EarningsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading earnings and expenses" />
      <SkeletonPageHeader />

      <SkeletonStatGrid count={2} className="grid grid-cols-2 items-stretch gap-3" />

      <Card>
        <CardBody>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <SkeletonCardHeader description />
        <div className="flex flex-col divide-y divide-line">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonAccordionRow key={i} />
          ))}
        </div>
      </Card>

      {/* Add expense form. */}
      <Card>
        <CardBody>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-3.5 w-24" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SkeletonField />
              <SkeletonField />
            </div>
            <SkeletonField />
            <div>
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-start">
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
  );
}
