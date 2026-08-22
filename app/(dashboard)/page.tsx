import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Badge, Card, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { EarningsPanel } from '@/components/earnings/earnings-panel';
import { SwipeNav } from '@/components/earnings/swipe-nav';
import {
  getOutstandingInvoiceTotalCents,
  getOwedToSuppliersCents,
  listRecentInvoices,
} from '@/lib/db/queries/overview';
import { getEarningsSummary } from '@/lib/db/queries/earnings';
import { countJobsByStatus, listJobsByStatus } from '@/lib/db/queries/jobs';
import { formatDate, numericToEur } from '@/lib/format';
import { formatEur } from '@/lib/money';
import { SkeletonList, SkeletonStatGrid, SkeletonTable } from '@/components/ui/skeleton';
import type { Job } from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Overview' };

// Always reflect the current state of the workshop; nothing here is cacheable.
export const dynamic = 'force-dynamic';

/** `href` makes the tile a real link into the section it summarises, rather than inert display. */
function Kpi({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-brand hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink tabular">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Link>
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
            <Td label="Job">
              <Link href={`/jobs/${job.id}`} className="font-medium text-brand-dark hover:underline">
                {job.jobNumber}
              </Link>
            </Td>
            <Td label="Customer">{job.customerName}</Td>
            <Td label="Vehicle" className="text-muted">
              {job.vehicleRegistration}
            </Td>
            <Td label="Due" className="text-muted">
              {formatDate(job.dueDate)}
            </Td>
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
      <Kpi label="Active jobs" value={String(counts.active)} href="/jobs?status=active" />
      <Kpi
        label="Completed jobs"
        value={String(counts.completed)}
        hint="Ready to invoice"
        href="/jobs?status=completed"
      />
      <Kpi
        label="Invoiced"
        value={String(counts.invoiced)}
        hint="Awaiting payment"
        href="/awaiting-payments"
      />
      <Kpi label="Paid" value={String(counts.paid)} href="/jobs?status=paid" />
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
        href="/awaiting-payments"
      />
      <Kpi
        label="Total owed to suppliers"
        value={formatEur(owedCents)}
        hint="Unpaid supplier bills"
        href="/suppliers"
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

/**
 * Desktop-only — mobile reaches the same panel at `/earnings` (a swipe or the
 * tap pill below). `hidden lg:block`, not `xl`: the sidebar-vs-mobile-chrome
 * switch in `dashboard-shell.tsx`/`sidebar.tsx` happens at `lg` everywhere in
 * this app, so gating on `xl` would mean a real 1024-1279px desktop viewport
 * gets the desktop shell but not this section.
 */
async function EarningsSection() {
  const summary = await getEarningsSummary();
  return <EarningsPanel summary={summary} />;
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
            <Td label="Invoice" className="font-medium">
              {invoice.invoiceNumber}
            </Td>
            <Td label="Job">
              <Link href={`/jobs/${invoice.jobId}`} className="text-brand-dark hover:underline">
                {invoice.jobNumber}
              </Link>
            </Td>
            <Td label="Customer">{invoice.customerName}</Td>
            <Td label="Issued" className="text-muted">
              {formatDate(invoice.issueDate)}
            </Td>
            <Td label="Total" className="text-right tabular">
              {numericToEur(invoice.grandTotal)}
            </Td>
            <Td label="Status">
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
    <SwipeNav to="/earnings" direction="left">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink">Overview</h1>
            <p className="text-sm text-muted">Current workload and money owed.</p>
          </div>
          {/* Discoverability hint for the swipe gesture, and a working
              tap-fallback for anyone who doesn't swipe — a gesture-only route
              would otherwise be a dead end. Desktop already shows Earnings
              inline below, so this is mobile-only. */}
          <Link
            href="/earnings"
            className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-brand-dark hover:bg-canvas lg:hidden"
          >
            Earnings →
          </Link>
        </div>

        <section aria-label="Job counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Suspense fallback={<SkeletonStatGrid count={4} className="contents" />}>
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

        <div className="hidden lg:block">
          <Suspense
            fallback={
              <div className="flex flex-col gap-4">
                <SkeletonStatGrid count={2} className="grid grid-cols-2 gap-3" />
                <Card>
                  <SkeletonList rows={4} />
                </Card>
              </div>
            }
          >
            <EarningsSection />
          </Suspense>
        </div>
      </div>
    </SwipeNav>
  );
}
