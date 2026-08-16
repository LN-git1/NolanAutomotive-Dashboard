import { Card } from '@/components/ui';
import {
  LoadingAnnouncement,
  SkeletonCardHeader,
  SkeletonStatGrid,
  SkeletonTable,
} from '@/components/ui/skeleton';

/**
 * Overview.
 *
 * This page fires six database queries in parallel, so it is the slowest first
 * paint in the app and the one that most needed a placeholder. The grid classes
 * are copied verbatim from `page.tsx` — `gap-6` between sections, `grid-cols-2
 * lg:grid-cols-4` for the counts, `sm:grid-cols-2` for the money — so the real
 * page drops into exactly this footprint without moving.
 */
export default function OverviewLoading() {
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement label="Loading the overview" />

      <div className="flex flex-col gap-2">
        <div className="skeleton h-5 w-28 rounded-md" aria-hidden />
        <div className="skeleton h-3.5 w-56 max-w-[70vw] rounded-md" aria-hidden />
      </div>

      <SkeletonStatGrid count={4} className="grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <SkeletonStatGrid count={2} className="grid grid-cols-1 gap-3 sm:grid-cols-2" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <SkeletonCardHeader description />
          <SkeletonTable columns={4} rows={4} />
        </Card>
        <Card>
          <SkeletonCardHeader description />
          <SkeletonTable columns={4} rows={4} />
        </Card>
      </div>

      <Card>
        <SkeletonCardHeader description />
        <SkeletonTable columns={6} rows={5} lastColumnRight />
      </Card>
    </div>
  );
}
