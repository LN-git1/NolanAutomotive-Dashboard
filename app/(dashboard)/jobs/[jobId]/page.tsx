import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttachmentManager } from '@/components/jobs/attachment-manager';
import { InvoiceCard } from '@/components/jobs/invoice-card';
import { JobActions } from '@/components/jobs/job-actions';
import { JobForm } from '@/components/jobs/job-form';
import { Badge, Card, CardHeader, LinkButton } from '@/components/ui';
import { getJobWithAttachments } from '@/lib/db/queries/jobs';
import { getSettings } from '@/lib/db/queries/settings';
import { labourRowCapacity, partsRowCapacity } from '@/lib/pdf/stamp';

export const metadata: Metadata = { title: 'Job' };
export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: PageProps<'/jobs/[jobId]'>) {
  const { jobId } = await params;
  const [job, settings] = await Promise.all([getJobWithAttachments(jobId), getSettings()]);

  if (!job) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ink">{job.jobNumber}</h1>
          <Badge value={job.status} />
          <Badge value={job.priority} />
        </div>

        <LinkButton href="/invoicer" variant="secondary">
          Open Invoicer
        </LinkButton>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <JobForm
            job={job}
            defaultHourlyRate={settings.defaultHourlyRate ?? ''}
            labourCapacity={labourRowCapacity()}
            partsCapacity={partsRowCapacity()}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Actions" />
            <JobActions jobId={job.id} status={job.status} />
          </Card>

          <Card>
            <CardHeader title="Attachments" description="Photos and receipts" />
            <AttachmentManager jobId={job.id} attachments={job.attachments} />
          </Card>

          <InvoiceCard
            invoices={job.invoices.map((invoice) => ({
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              issueDate: invoice.issueDate,
              grandTotal: invoice.grandTotal,
              voidedAt: invoice.voidedAt ? invoice.voidedAt.toISOString() : null,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
