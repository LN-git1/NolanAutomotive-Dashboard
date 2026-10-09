import { Alert } from '@/components/ui';
import {
  LoadingAnnouncement,
  Skeleton,
  SkeletonCardHeader,
} from '@/components/ui/skeleton';
import { Card, CardBody } from '@/components/ui';

/**
 * Development-only coordinate mapper.
 *
 * Header, the warning alert, then the two-column canvas/controls layout. The
 * canvas placeholder keeps the template's portrait aspect so the controls
 * column does not jump sideways when the real render lands.
 */
export default function TemplateMapperLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingAnnouncement label="Loading the template mapper" />

      <div>
        <div className="skeleton h-7 w-48 rounded-md" aria-hidden />
        <div className="skeleton mt-2 h-5 w-full max-w-xl rounded-md" aria-hidden />
      </div>

      <Alert tone="warn">
        Saving overwrites <code>lib/pdf/invoiceTemplateCoords.json</code> in the source tree.
      </Alert>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[auto_24rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="aspect-[1/1.4] w-full max-w-xl" />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SkeletonCardHeader />
            <CardBody className="flex flex-col gap-3">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </CardBody>
          </Card>
          <Skeleton className="h-9 w-40 rounded-md" />
        </div>
      </div>
    </div>
  );
}
