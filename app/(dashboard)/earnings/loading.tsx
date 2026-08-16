import { Card } from '@/components/ui';
import { LoadingAnnouncement, SkeletonPageHeader, SkeletonList, SkeletonStatGrid } from '@/components/ui/skeleton';

export default function EarningsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading earnings" />
      <SkeletonPageHeader />

      <SkeletonStatGrid count={2} className="grid grid-cols-2 gap-3" />

      <Card>
        <SkeletonList rows={4} />
      </Card>
    </div>
  );
}
