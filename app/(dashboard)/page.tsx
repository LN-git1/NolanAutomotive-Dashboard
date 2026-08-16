import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Badge, Card, CardBody, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import {
  getOutstandingInvoiceTotalCents,
  getOwedToSuppliersCents,
  listRecentInvoices,
} from '@/lib/db/queries/overview';
import { countJobsByStatus, listJobsByStatus } from '@/lib/db/queries/jobs';
import { formatDate, numericToEur } from '@/lib/format';
import { formatEur } from '@/lib/money';
import { SkeletonStatGrid, SkeletonTable } from '@/components/ui/skeleton';
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

/**
 * Each section owns its own query and streams on its own.
 *
 * These six reads used to be one `Promise.all`, which meant the whole page
 * waited on the slowest of them before anything appeared. Wrapped in Suspense
 * they arrive independently: the job counts — three fast aggregates — paint
 * while the invoice join is still running, and each section shows the same
 * skeleton in the meantime that `loading.tsx` shows for the page as a whole.
 *
 * `loading.tsx` still covers the navigation itself; this covers what happens
 * after the shell is up.
 */

async function JobCounts() {
  const counts = await countJobsByStatus();

  return (
    <>
      <Kpi label="Active jobs" value={String(counts.active)} />
      <Kpi label="Completed jobs" value={String(counts.completed)} hint="Ready to invoice" />
      <Kpi label="Invoiced" value={String(counts.invoiced)} hint="Awaiting payment" />
      <Kpi label="Paid" value={String(counts.paid)} />
    </>
  );
}

async function MoneyTotals() {
  const [outstandingCents, owedCents] = await Promise.all([
    getOutstandingInvoiceTotalCents(),
    getOwedToSuppliersCents(),
  ]);

  return (
    <>
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
    </>
  );
}

async function JobsByStatus({
  status,
  emptyText,
}: {
  status: 'active' | 'completed';
  emptyText: string;
}) {
  const jobs = await listJobsByStatus(status, 10);
  return <JobList jobs={jobs} emptyText={emptyText} />;
}

async function RecentInvoices() {
  const recentInvoices = await listRecentInvoices(10);

  if (recentInvoices.length === 0) return <Empty>No invoices issued yet.</Empty>;

  return (
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
              <Link href={`/jobs/${invoice.jobId}`} className="text-brand-dark hover:underline">
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
  );
}

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Overview</h1>
        <p className="text-sm text-muted">Current workload and money owed.</p>
      </div>

      <section aria-label="Job counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Suspense
          fallback={<SkeletonStatGrid count={4} className="contents" />}
        >
          <JobCounts />
        </Suspense>
      </section>

      <section aria-label="Money" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Suspense fallback={<SkeletonStatGrid count={2} className="contents" />}>
          <MoneyTotals />
        </Suspense>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Active jobs" description="Latest 10" />
          <Suspense fallback={<SkeletonTable columns={4} rows={4} />}>
            <JobsByStatus status="active" emptyText="No active jobs." />
          </Suspense>
        </Card>

        <Card>
          <CardHeader title="Completed jobs" description="Latest 10 — ready to invoice" />
          <Suspense fallback={<SkeletonTable columns={4} rows={4} />}>
            <JobsByStatus status="completed" emptyText="No completed jobs waiting." />
          </Suspense>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recently invoiced" description="Latest 10" />
        <Suspense fallback={<SkeletonTable columns={6} rows={5} lastColumnRight />}>
          <RecentInvoices />
        </Suspense>
      </Card>
    </div>
  );
}
