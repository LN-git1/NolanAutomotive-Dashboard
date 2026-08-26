import type { Metadata } from 'next';
import Link from 'next/link';

import { MarkPaidButton } from '@/components/payments/mark-paid-button';
import { Card, CardBody, Empty, Input, LinkButton, Table, Td, Th, Button } from '@/components/ui';
import { listAwaitingPayment } from '@/lib/db/queries/jobs';
import { formatDate } from '@/lib/format';
import { formatEur } from '@/lib/money';

export const metadata: Metadata = { title: 'Invoiced jobs' };
export const dynamic = 'force-dynamic';

/**
 * Work that has been billed and not yet paid — the middle of the three lists.
 *
 * A job moves here the moment its invoice is issued and leaves for /paid-jobs
 * when the last of the money lands, so the three pages track the three things
 * that can be true of a job: it is in the workshop, it is billed, it is done.
 * `/jobs` used to hold the first two at once, which is what made it grow into a
 * list nobody could work from.
 *
 * The route is still `/awaiting-payments`. Only the name the owner sees
 * changed: half a dozen `revalidatePath` calls across the actions and the
 * invoice routes point at this path, and renaming the directory would mean
 * touching every one of them to move a page that is already where it needs to
 * be.
 *
 * Membership is decided by the payments, not by `jobs.status` — see
 * `lib/db/queries/invoice-state.ts`.
 */
export default async function InvoicedJobsPage({
  searchParams,
}: PageProps<'/awaiting-payments'>) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const rows = await listAwaitingPayment(q);

  // Same field the row-level Total column renders — the header and the rows
  // must never disagree about what "owed" means (they used to: the header
  // summed grandTotal directly while a partial payment would only ever show
  // in the row, silently diverging).
  const totalCents = rows.reduce((sum, row) => sum + Number(row.remainingCents), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Invoiced jobs</h1>
          <p className="text-sm text-muted">
            {rows.length} {rows.length === 1 ? 'job' : 'jobs'} invoiced and awaiting payment
            {q ? ` matching “${q}”` : ''}
          </p>
        </div>
        <LinkButton href="/jobs" variant="secondary">
          Workshop jobs
        </LinkButton>
      </div>

      {/* GET form, like the other two lists: the search lives in the URL so it
          survives a refresh and can be linked to — which is what the "N invoiced
          jobs also match" hint on /jobs points at. */}
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
            <LinkButton href="/awaiting-payments" variant="ghost">
              Clear
            </LinkButton>
          ) : null}
        </form>
      </Card>

      <Card>
        <CardBody>
          <p className="text-xs font-medium text-muted">Total outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-ink tabular">{formatEur(totalCents)}</p>
          {/* Says which rows the figure covers, because a search narrows it. */}
          <p className="mt-1 text-xs text-muted">
            {q ? 'Across the matching jobs below' : 'Across every invoiced job below'}
          </p>
        </CardBody>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <Empty>
            {q
              ? 'No invoiced jobs match that search.'
              : 'Nothing outstanding. Every invoiced job has been paid.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Customer</Th>
                <Th>Vehicle</Th>
                <Th>Invoice</Th>
                <Th>Issued</Th>
                <Th className="text-right">Owed</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, invoice, remainingCents }) => (
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
                  {/* Matches the other two job lists column for column, so the
                      same car is recognisable at a glance whichever of the three
                      pages it currently sits on. */}
                  <Td label="Vehicle">
                    <div className="font-medium">{job.vehicleRegistration}</div>
                    <div className="text-xs text-muted">
                      {[job.vehicleMake, job.vehicleModel].filter(Boolean).join(' ') || '—'}
                    </div>
                  </Td>
                  <Td label="Invoice">
                    {invoice ? (
                      <Link
                        href={`/api/invoices/${invoice.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-dark hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td label="Issued" className="text-muted">
                    {formatDate(invoice?.issueDate)}
                  </Td>
                  <Td label="Owed" className="text-right tabular">
                    {formatEur(Number(remainingCents))}
                  </Td>
                  <Td label="Action" className="text-right">
                    <MarkPaidButton
                      invoiceId={invoice.id}
                      jobNumber={job.jobNumber}
                      remainingCents={Number(remainingCents)}
                    />
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
