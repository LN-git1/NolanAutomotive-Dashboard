import {
  LoadingAnnouncement,
  SkeletonCollapsibleCard,
  SkeletonStatGrid,
} from '@/components/ui/skeleton';

/**
 * Overview.
 *
 * This page fires six database queries in parallel, so it is the slowest first
 * paint in the app and the one that most needed a placeholder. The grid classes
 * are copied verbatim from `page.tsx` — `gap-6` between sections, `grid-cols-2
 * lg:grid-cols-4` for the counts, `sm:grid-cols-2` for the money — so the real
 * page drops into exactly this footprint without moving. The three list
 * sections are collapsed cards on the real page, so they are collapsed here
 * too.
 */
export default function OverviewLoading() {
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement label="Loading the overview" />

      <div className="flex flex-col gap-2">
        <div className="skeleton h-5 w-28 rounded-md" aria-hidden />
        <div className="skeleton h-3.5 w-56 max-w-[70vw] rounded-md" aria-hidden />
      </div>

      <SkeletonStatGrid count={3} className="grid grid-cols-3 gap-3" />
      <SkeletonStatGrid count={2} className="grid grid-cols-1 gap-3 sm:grid-cols-2" />

      {/* Three collapsed headers, not three tables: the sections on the real
          page start closed, so drawing full tables here meant every navigation
          painted several hundred pixels of skeleton and then snapped shut. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SkeletonCollapsibleCard />
        <SkeletonCollapsibleCard />
      </div>

      <SkeletonCollapsibleCard />
    </div>
  );
}
