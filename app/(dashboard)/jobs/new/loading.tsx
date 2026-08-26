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
 * Registration is its own always-open card; every other section — Customer,
 * Vehicle, Work and labour, Parts, Scheduling and notes — starts collapsed.
 * This mirrors that exactly — see `components/jobs/job-form.tsx`.
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

      <SkeletonCollapsedSection />
      <SkeletonCollapsedSection />
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
