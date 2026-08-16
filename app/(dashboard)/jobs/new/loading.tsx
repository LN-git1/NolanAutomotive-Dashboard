import { Card } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
  SkeletonCollapsedSection,
  SkeletonField,
} from '@/components/ui/skeleton';

/**
 * New job.
 *
 * Only Registration, Customer and Vehicle are open on a new job; work, parts
 * and notes start collapsed. This mirrors that exactly — see the `defaultOpen`
 * props in `components/jobs/job-form.tsx`.
 */
export default function NewJobLoading() {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <LoadingAnnouncement label="Loading the new job form" />

      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3.5 w-72 max-w-[80vw]" />
      </div>

      <Card>
        <SkeletonCardHeader description />
        <div className="p-4">
          <SkeletonField />
        </div>
      </Card>

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

      <Card>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-4 rounded" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-60 max-w-[55vw]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 border-t border-line p-4 sm:grid-cols-2">
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
        </div>
      </Card>

      <SkeletonCollapsedSection />
      <SkeletonCollapsedSection />
      <SkeletonCollapsedSection />

      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
  );
}
