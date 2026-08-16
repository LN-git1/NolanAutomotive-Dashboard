import { Card } from '@/components/ui';
import {
  LoadingAnnouncement,
  SkeletonField,
  SkeletonPageHeader,
  SkeletonTable,
} from '@/components/ui/skeleton';

/**
 * Jobs list: header with a "New job" action, the search/filter bar, then the
 * table. Six columns, matching Job / Customer / Vehicle / Status / Priority / Due.
 */
export default function JobsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading jobs" />
      <SkeletonPageHeader action />

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <SkeletonField className="min-w-56 flex-1" />
          <SkeletonField className="w-44" />
        </div>
      </Card>

      <Card>
        <SkeletonTable columns={6} rows={8} />
      </Card>
    </div>
  );
}
