import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AttachmentManager } from '@/components/jobs/attachment-manager';
import { JobActions } from '@/components/jobs/job-actions';
import { JobForm } from '@/components/jobs/job-form';
import { Badge, Card, CardHeader, Empty, LinkButton, Table, Td, Th } from '@/components/ui';
import { getJobWithAttachments } from '@/lib/db/queries/jobs';
import { formatDate, numericToEur } from '@/lib/format';

export const metadata: Metadata = { title: 'Job' };
export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: PageProps<'/jobs/[jobId]'>) {
  const { jobId } = await params;
  const job = await getJobWithAttachments(jobId);

  if (!job) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ink">{job.jobNumber}</h1>
          <Badge value={job.status} />
          <Badge value={job.priority} />
        </div>

        {job.status !== 'paid' ? (
          <LinkButton href="/invoicer" variant="secondary">
            Open Invoicer
          </LinkButton>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <JobForm job={job} />
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

          <Card>
            <CardHeader title="Invoices" />
            {job.invoices.length === 0 ? (
              <Empty>No invoice issued for this job yet.</Empty>
            ) : (
              <Table className="min-w-0">
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Issued</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {job.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <Td>
                        <Link
                          href={`/api/invoices/${invoice.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-brand-dark hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </Td>
                      <Td className="text-muted">{formatDate(invoice.issueDate)}</Td>
                      <Td className="text-right tabular">{numericToEur(invoice.grandTotal)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
