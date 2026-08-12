import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, Card, CardBody, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import {
  getOutstandingInvoiceTotalCents,
  getOwedToSuppliersCents,
  listRecentInvoices,
} from '@/lib/db/queries/overview';
import { countJobsByStatus, listJobsByStatus } from '@/lib/db/queries/jobs';
import { formatDate, numericToEur } from '@/lib/format';
import { formatEur } from '@/lib/money';
import type { Job } from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Overview' };

// Always reflect the current state of the workshop; nothing here is cacheable.
export const dynamic = 'force-dynamic';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-ink tabular">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

function JobList({ jobs, emptyText }: { jobs: Job[]; emptyText: string }) {
  if (jobs.length === 0) return <Empty>{emptyText}</Empty>;

  return (
    <Table>
      <thead>
        <tr>
          <Th>Job</Th>
          <Th>Customer</Th>
          <Th>Vehicle</Th>
          <Th>Due</Th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <Td>
              <Link href={`/jobs/${job.id}`} className="font-medium text-brand-dark hover:underline">
                {job.jobNumber}
              </Link>
            </Td>
            <Td>{job.customerName}</Td>
            <Td className="text-muted">{job.vehicleRegistration}</Td>
            <Td className="text-muted">{formatDate(job.dueDate)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function OverviewPage() {
  // Independent reads — issue them together rather than in sequence.
  const [counts, outstandingCents, owedCents, activeJobs, completedJobs, recentInvoices] =
    await Promise.all([
      countJobsByStatus(),
      getOutstandingInvoiceTotalCents(),
      getOwedToSuppliersCents(),
      listJobsByStatus('active', 10),
      listJobsByStatus('completed', 10),
      listRecentInvoices(10),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Overview</h1>
        <p className="text-sm text-muted">Current workload and money owed.</p>
      </div>

      <section aria-label="Job counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active jobs" value={String(counts.active)} />
        <Kpi label="Completed jobs" value={String(counts.completed)} hint="Ready to invoice" />
        <Kpi label="Invoiced" value={String(counts.invoiced)} hint="Awaiting payment" />
        <Kpi label="Paid" value={String(counts.paid)} />
      </section>

      <section aria-label="Money" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Kpi
          label="Total outstanding"
          value={formatEur(outstandingCents)}
          hint="Invoiced but not yet paid"
        />
        <Kpi
          label="Total owed to suppliers"
          value={formatEur(owedCents)}
          hint="Unpaid supplier bills"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Active jobs" description="Latest 10" />
          <JobList jobs={activeJobs} emptyText="No active jobs." />
        </Card>

        <Card>
          <CardHeader title="Completed jobs" description="Latest 10 — ready to invoice" />
          <JobList jobs={completedJobs} emptyText="No completed jobs waiting." />
        </Card>
      </div>

      <Card>
        <CardHeader title="Recently invoiced" description="Latest 10" />
        {recentInvoices.length === 0 ? (
          <Empty>No invoices issued yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Job</Th>
                <Th>Customer</Th>
                <Th>Issued</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <Td className="font-medium">{invoice.invoiceNumber}</Td>
                  <Td>
                    <Link
                      href={`/jobs/${invoice.jobId}`}
                      className="text-brand-dark hover:underline"
                    >
                      {invoice.jobNumber}
                    </Link>
                  </Td>
                  <Td>{invoice.customerName}</Td>
                  <Td className="text-muted">{formatDate(invoice.issueDate)}</Td>
                  <Td className="text-right tabular">{numericToEur(invoice.grandTotal)}</Td>
                  <Td>
                    <Badge value={invoice.jobStatus} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
