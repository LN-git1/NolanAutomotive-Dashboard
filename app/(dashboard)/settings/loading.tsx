import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonField,
  SkeletonFormCard,
  SkeletonPageHeader,
} from '@/components/ui/skeleton';

/** Settings: business details, invoicing defaults, exports, danger zone. */
export default function SettingsLoading() {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <LoadingAnnouncement label="Loading settings" />
      <SkeletonPageHeader />

      {/* Business details — name, phone, email, then a full-width address. */}
      <Card>
        <SkeletonCardHeader description />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
          <SkeletonField className="sm:col-span-2" />
        </div>
      </Card>

      <SkeletonFormCard fields={3} columns={2} />

      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-56 max-w-full rounded-md" />
          ))}
        </CardBody>
      </Card>

      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-3">
          <Skeleton className="h-3.5 w-full max-w-lg" />
          <Skeleton className="h-9 w-40 rounded-md" />
        </CardBody>
      </Card>
    </div>
  );
}
