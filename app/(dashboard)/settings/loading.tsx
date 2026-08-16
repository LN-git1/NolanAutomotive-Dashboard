import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonField,
  SkeletonPageHeader,
} from '@/components/ui/skeleton';

/**
 * Settings.
 *
 * Five cards, not four — the form renders business details, VAT and invoicing
 * defaults as separate cards, then the page adds data export and the danger
 * zone. An earlier version of this file guessed at four uniform field cards and
 * came out 690px short, which measured as a 39% jump when the real page landed.
 *
 * Two details that carry most of that height: the address is a 3-row `Textarea`
 * rather than an `Input`, and the VAT card leads with a checkbox row.
 */
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Skeleton className="h-3 w-24" />
            {/* rows={3} on the real Textarea. */}
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        </div>
      </Card>

      {/* VAT — a checkbox, then the number and rate. */}
      <Card>
        <SkeletonCardHeader description />
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3.5 w-48 max-w-[60vw]" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SkeletonField />
            <SkeletonField />
          </div>
        </div>
      </Card>

      {/* Invoicing defaults. */}
      <Card>
        <SkeletonCardHeader />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <SkeletonField />
        </div>
      </Card>

      <Skeleton className="h-9 w-32 rounded-md" />

      {/* Data export — one button per CSV. */}
      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-56 max-w-full rounded-md" />
          ))}
        </CardBody>
      </Card>

      {/* Danger zone. */}
      <Card>
        <SkeletonCardHeader description />
        <CardBody className="flex flex-col gap-3">
          <Skeleton className="h-3.5 w-full max-w-lg" />
          <Skeleton className="h-3.5 w-3/4 max-w-md" />
          <Skeleton className="h-9 w-40 rounded-md" />
        </CardBody>
      </Card>
    </div>
  );
}
