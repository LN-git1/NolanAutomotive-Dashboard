import { Card } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonCollapsedSection,
  SkeletonField,
  SkeletonTable,
} from '@/components/ui/skeleton';

/**
 * A job.
 *
 * Every one of the form's five sections starts collapsed — only the
 * Registration card above them is always open — so the skeleton shows five
 * header bars rather than however many the previous version happened to
 * render open.
 */
export default function JobLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading job" />

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {/* Registration card — always open, always first. */}
          <Card>
            <SkeletonCardHeader description />
            <div className="p-4">
              <SkeletonField />
            </div>
          </Card>

          <SkeletonCollapsedSection />
          <SkeletonCollapsedSection />
          <SkeletonCollapsedSection />
          <SkeletonCollapsedSection />
          <SkeletonCollapsedSection />

          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Actions — status select, then the delete button. */}
          <Card>
            <SkeletonCardHeader />
            <div className="flex flex-col gap-3 p-4">
              <SkeletonField />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </Card>

          {/* Attachments — upload label, then file rows. */}
          <Card>
            <SkeletonCardHeader description />
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-9 w-44 rounded-md" />
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-10 w-24 shrink-0 rounded-md" />
              </div>
            </div>
          </Card>

          {/* Invoices — header and the empty state it usually shows. */}
          <Card>
            <SkeletonCardHeader />
            <p className="px-4 py-8 text-center">
              <Skeleton className="mx-auto h-3.5 w-48" />
            </p>
          </Card>

          {/* Payments — date/amount rows. */}
          <Card>
            <SkeletonCardHeader />
            <SkeletonTable columns={2} rows={3} lastColumnRight />
          </Card>
        </div>
      </div>
    </div>
  );
}
