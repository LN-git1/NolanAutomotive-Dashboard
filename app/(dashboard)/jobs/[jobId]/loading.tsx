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
 * The form's sections are collapsed by default on an existing job except
 * "Customer" and "Work and labour", so the skeleton shows two open sections and
 * the rest as header bars. Matching the collapsed/expanded split matters more
 * than it looks: showing five expanded sections would make the page settle
 * upwards by several hundred pixels.
 */
export default function JobLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading job" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
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

          {/* Customer — open by default. */}
          <Card>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-line p-4 sm:grid-cols-2">
              <SkeletonField className="sm:col-span-2" />
              <SkeletonField />
              <SkeletonField />
            </div>
          </Card>

          <SkeletonCollapsedSection />

          {/* Work and labour — open by default on an existing job. */}
          <Card>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-4 rounded" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-56 max-w-[55vw]" />
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-line p-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-32 rounded-md" />
              </div>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-md border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="size-8 rounded-md" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <SkeletonField className="col-span-2" />
                    <SkeletonField />
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
                <SkeletonField />
                <SkeletonField />
                <SkeletonField className="col-span-2" />
              </div>
            </div>
          </Card>

          <SkeletonCollapsedSection />
          <SkeletonCollapsedSection />

          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SkeletonCardHeader />
            <div className="flex flex-col gap-3 p-4">
              <SkeletonField />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </Card>

          <Card>
            <SkeletonCardHeader description />
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-9 w-48 rounded-md" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          </Card>

          <Card>
            <SkeletonCardHeader />
            <SkeletonTable columns={3} rows={2} lastColumnRight />
          </Card>
        </div>
      </div>
    </div>
  );
}
