import { Card, CardBody } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
} from '@/components/ui/skeleton';

/**
 * Invoicer: the job picker column beside the preview pane. The
 * `xl:grid-cols-[26rem_1fr]` split comes straight from the page.
 */
export default function InvoicerLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading the invoicer" />

      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3.5 w-96 max-w-[85vw]" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[26rem_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <SkeletonCardHeader description />
            <CardBody className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full rounded-md" />
              <div className="flex flex-col divide-y divide-line rounded-md border border-line">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-40 max-w-[45vw]" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <SkeletonCardHeader description />
            <CardBody className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-40 rounded-md" />
          <Card>
            {/* Matches the empty preview panel's height so the pane does not
                collapse and re-expand when the real one renders. */}
            <div className="px-4 py-16">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <Skeleton className="h-3.5 w-64 max-w-full" />
                <Skeleton className="h-3.5 w-48 max-w-full" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
