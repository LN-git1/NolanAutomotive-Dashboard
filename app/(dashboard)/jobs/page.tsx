import type { Metadata } from 'next';
import Link from 'next/link';

import {
  Badge,
  Card,
  Empty,
  Input,
  LinkButton,
  Select,
  Table,
  Td,
  Th,
  Button,
} from '@/components/ui';
import {
  countAwaitingPaymentJobs,
  countJobPipeline,
  countSettledJobs,
  listJobs,
} from '@/lib/db/queries/jobs';
import { formatDate } from '@/lib/format';
import { JOB_STATUS_LABELS } from '@/lib/validation/job';
import type { JobStatus } from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

/**
 * The statuses work in the workshop can be in.
 *
 * `invoiced` and `paid` are both absent deliberately, for the same reason:
 * neither can appear in this list any more, so offering either would be a
 * filter that can only ever return nothing. Billed work is on
 * `/awaiting-payments`, settled work on `/paid-jobs`.
 */
const WORKSHOP_STATUSES = ['active', 'completed'] as const;

export default async function JobsPage({ searchParams }: PageProps<'/jobs'>) {
  const params = await searchParams;

  const q = typeof params.q === 'string' ? params.q : undefined;
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const status = (WORKSHOP_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as JobStatus)
    : 'all';

  /*
    `scope: 'pre-invoice'` is the whole point of this page: the cars actually in
    the workshop. It used to be `open`, which also carried every job that had
    been invoiced and not yet paid — so a job Lee had already billed sat in the
    list he uses to decide what to do next, and the list only ever grew. Work
    moves out of here the moment it is invoiced, on to /awaiting-payments, and
    on again to /paid-jobs once it is settled.

    Both of the buckets this page no longer shows are counted rather than hidden
    outright: searching here for a customer billed yesterday, or one who paid
    last month, would otherwise come back empty and read as "we lost the job",
    which is worse than the clutter the split removes.
  */
  const filtered = Boolean(q) || status !== 'all';

  const [jobs, invoicedMatches, settledMatches, pipeline] = await Promise.all([
    listJobs({ q, status, scope: 'pre-invoice' }),
    countAwaitingPaymentJobs(q),
    countSettledJobs(q),
    // Only for the unfiltered view: the breakdown counts every job in the
    // workshop, and with a search or status filter on, the header count would
    // not agree with it.
    filtered ? null : countJobPipeline(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Jobs</h1>
          <p className="text-sm text-muted">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} in the workshop
            {q ? ` matching “${q}”` : ''}
            {pipeline ? ` — ${pipeline.invoiced} more invoiced and awaiting payment` : ''}
          </p>
        </div>
        <LinkButton href="/jobs/new">New job</LinkButton>
      </div>

      {/* GET form: the search lives in the URL so it survives refresh and can be shared. */}
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

          <div className="flex w-44 flex-col gap-1.5">
            <label htmlFor="status" className="text-xs font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="all">All workshop jobs</option>
              {WORKSHOP_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {JOB_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {q || status !== 'all' ? (
            <LinkButton href="/jobs" variant="ghost">
              Clear
            </LinkButton>
          ) : null}
        </form>
      </Card>

      {/* Points at the other two thirds of the split rather than leaving a dead
          end. Shown whenever jobs match there, including with no search at all,
          so both pages stay discoverable from the list they were carved out of
          — and the search term is carried across, so the link lands on the
          matching rows rather than making the reader search again. */}
      {invoicedMatches > 0 || settledMatches > 0 ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {invoicedMatches > 0 ? (
            <span>
              {invoicedMatches} invoiced {invoicedMatches === 1 ? 'job' : 'jobs'}
              {q ? (invoicedMatches === 1 ? ' also matches' : ' also match') : ''} under{' '}
              <Link
                href={q ? `/awaiting-payments?q=${encodeURIComponent(q)}` : '/awaiting-payments'}
                className="font-medium text-brand-dark hover:underline"
              >
                Invoiced jobs
              </Link>
              .
            </span>
          ) : null}
          {settledMatches > 0 ? (
            <span>
              {settledMatches} paid {settledMatches === 1 ? 'job' : 'jobs'}
              {q ? (settledMatches === 1 ? ' also matches' : ' also match') : ''} under{' '}
              <Link
                href={q ? `/paid-jobs?q=${encodeURIComponent(q)}` : '/paid-jobs'}
                className="font-medium text-brand-dark hover:underline"
              >
                Paid jobs
              </Link>
              .
            </span>
          ) : null}
        </p>
      ) : null}

      <Card>
        {jobs.length === 0 ? (
          <Empty>
            {q || status !== 'all'
              ? 'No workshop jobs match that search.'
              : 'Nothing in the workshop. Create a job to get started.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Customer</Th>
                <Th>Vehicle</Th>
                <Th>Status</Th>
                <Th>Priority</Th>
                <Th>Due</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
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
                  <Td label="Status">
                    <Badge value={job.status} />
                  </Td>
                  <Td label="Priority">
                    <Badge value={job.priority} />
                  </Td>
                  <Td label="Due" className="text-muted">
                    {formatDate(job.dueDate)}
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
