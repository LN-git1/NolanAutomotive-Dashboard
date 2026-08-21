import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttachmentManager } from '@/components/jobs/attachment-manager';
import { InvoiceCard } from '@/components/jobs/invoice-card';
import { JobActions } from '@/components/jobs/job-actions';
import { JobForm } from '@/components/jobs/job-form';
import { PaymentHistory } from '@/components/jobs/payment-history';
import { Badge, Card, CardHeader } from '@/components/ui';
import { getJobWithAttachments } from '@/lib/db/queries/jobs';
import { getSettings } from '@/lib/db/queries/settings';
import { toCents } from '@/lib/money';
import { labourRowCapacity, partsRowCapacity } from '@/lib/pdf/stamp';

export const metadata: Metadata = { title: 'Job' };
export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: PageProps<'/jobs/[jobId]'>) {
  const { jobId } = await params;
  const [job, settings] = await Promise.all([getJobWithAttachments(jobId), getSettings()]);

  if (!job) notFound();

  /*
    The one non-voided invoice, with what is still owed on it — `JobActions`
    needs both to drive the mark-paid modal. `getJobWithAttachments` already
    loads invoices with their payments, so this costs no extra query. `toCents`
    because Drizzle hands back `numeric` columns as strings.
  */
  const live = job.invoices.find((invoice) => !invoice.voidedAt);
  const liveInvoice = live
    ? {
        id: live.id,
        remainingCents: Math.max(
          toCents(live.grandTotal) -
            live.payments.reduce((sum, payment) => sum + toCents(payment.amount), 0),
          0,
        ),
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/*
        No "Open Invoicer" shortcut here. Invoicing starts from the Invoicer —
        sidebar on desktop, bottom bar on a phone — where a job is chosen and the
        invoice generated. One route in, rather than two.
      */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-ink">{job.jobNumber}</h1>
        <Badge value={job.status} />
        <Badge value={job.priority} />
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
            <JobActions
              jobId={job.id}
              jobNumber={job.jobNumber}
              status={job.status}
              liveInvoice={liveInvoice}
            />
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

          <PaymentHistory
            payments={job.invoices
              .filter((invoice) => !invoice.voidedAt)
              .flatMap((invoice) => invoice.payments)}
          />
        </div>
      </div>
    </div>
  );
}
