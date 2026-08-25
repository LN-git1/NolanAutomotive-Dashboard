import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardBody, Empty, Input, LinkButton, Table, Td, Th, Button } from '@/components/ui';
import { listSettledJobs } from '@/lib/db/queries/jobs';
import { formatDate, numericToEur } from '@/lib/format';
import { formatEur, toCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Paid jobs' };
export const dynamic = 'force-dynamic';

/**
 * Finished business, kept out of the way of the work still in front of you.
 *
 * `/jobs` used to list every job ever created, so the jobs the owner actually
 * needed — the cars in the workshop and the invoices still owed — were buried
 * under work that had been settled months ago. Those two lists are now split at
 * the only line that matters day to day: has this been paid for.
 *
 * Membership is decided by the payments, not by `jobs.status` — see
 * `lib/db/queries/invoice-state.ts`. A job appears here the moment its invoice
 * is settled in full and cannot be argued out of it by a status label.
 */
export default async function PaidJobsPage({ searchParams }: PageProps<'/paid-jobs'>) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const rows = await listSettledJobs(q);

  // Settled means paid in full, and `applyPayment` refuses anything above the
  // remaining balance, so the invoice total IS what was collected.
  const collectedCents = rows.reduce((sum, row) => sum + toCents(row.invoice.grandTotal), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Paid jobs</h1>
          <p className="text-sm text-muted">
            {rows.length} {rows.length === 1 ? 'job' : 'jobs'} invoiced and settled in full
            {q ? ` matching “${q}”` : ''}
          </p>
        </div>
        <LinkButton href="/jobs" variant="secondary">
          Open jobs
        </LinkButton>
      </div>

      {/* GET form, like the jobs list: the search lives in the URL so it
          survives a refresh and can be linked to — which is what the "also
          matched N paid jobs" hint on /jobs points at. */}
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <label htmlFor="q" className="text-xs font-medium text-ink">
              Search
            </label>
            <Input
              id="q"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Job number, customer name or registration"
            />
          </div>

          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {q ? (
            <LinkButton href="/paid-jobs" variant="ghost">
              Clear
            </LinkButton>
          ) : null}
        </form>
      </Card>

      <Card>
        <CardBody>
          <p className="text-xs font-medium text-muted">Total collected</p>
          <p className="mt-1 text-2xl font-semibold text-ink tabular">
            {formatEur(collectedCents)}
          </p>
          {/* Says which rows the figure covers, because a search narrows it.
              Earnings remains the place for money over a period. */}
          <p className="mt-1 text-xs text-muted">
            {q ? 'Across the matching jobs below' : 'Across every settled job below'}
          </p>
        </CardBody>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <Empty>
            {q
              ? 'No paid jobs match that search.'
              : 'No jobs have been paid in full yet. Settled invoices land here automatically.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Customer</Th>
                <Th>Vehicle</Th>
                <Th>Invoice</Th>
                <Th>Paid on</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, invoice, paidAt }) => (
                <tr key={job.id}>
                  <Td label="Job">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-brand-dark hover:underline"
                    >
                      {job.jobNumber}
                    </Link>
                  </Td>
                  <Td label="Customer">
                    <div>{job.customerName}</div>
                    {job.customerPhone ? (
                      <div className="text-xs text-muted">{job.customerPhone}</div>
                    ) : null}
                  </Td>
                  <Td label="Vehicle">
                    <div className="font-medium">{job.vehicleRegistration}</div>
                    <div className="text-xs text-muted">
                      {[job.vehicleMake, job.vehicleModel].filter(Boolean).join(' ') || '—'}
                    </div>
                  </Td>
                  <Td label="Invoice">
                    {/* A plain link, not window.open — an iOS home-screen PWA
                        blocks a popup opened after an await. */}
                    <Link
                      href={`/api/invoices/${invoice.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-dark hover:underline"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                  </Td>
                  <Td label="Paid on" className="text-muted">
                    {formatDate(paidAt)}
                  </Td>
                  <Td label="Total" className="text-right tabular">
                    {numericToEur(invoice.grandTotal)}
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
