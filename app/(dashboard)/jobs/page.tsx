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
import { countJobPipeline, countSettledJobs, listJobs } from '@/lib/db/queries/jobs';
import { formatDate } from '@/lib/format';
import { JOB_STATUS_LABELS } from '@/lib/validation/job';
import type { JobStatus } from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

/**
 * The statuses a job can still be in while it is open work. `paid` is absent
 * deliberately: settled jobs live on `/paid-jobs` now, so offering it here
 * would be a filter that can only ever return nothing.
 */
const OPEN_STATUSES = ['active', 'completed', 'invoiced'] as const;

export default async function JobsPage({ searchParams }: PageProps<'/jobs'>) {
  const params = await searchParams;

  const q = typeof params.q === 'string' ? params.q : undefined;
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const status = (OPEN_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as JobStatus)
    : 'all';

  /*
    `scope: 'open'` is the whole point of this page now: work still in the
    workshop, plus work invoiced and still owed. Anything settled in full has
    moved to /paid-jobs, so the list the owner opens twenty times a day is only
    the jobs that still need something doing to them.

    Settled matches are counted rather than hidden outright — searching here for
    a customer who paid last month would otherwise come back empty and read as
    "we lost the job", which is worse than the clutter this split removes.
  */
  const filtered = Boolean(q) || status !== 'all';

  const [jobs, settledMatches, pipeline] = await Promise.all([
    listJobs({ q, status, scope: 'open' }),
    countSettledJobs(q),
    /*
      Only for the unfiltered view, where it explains the one number a reader
      can otherwise trip over: the Overview's "Active jobs" tile counts work
      that has not been billed yet, and clicking it lands here on a longer list
      that also includes invoiced work still owed. Showing the split makes the
      tile's figure visible at the destination instead of looking like a
      contradiction — which is the class of thing this whole change is fixing.
      Skipped when a search or status filter is on, because the breakdown counts
      every open job and the header count would not.
    */
    filtered ? null : countJobPipeline(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Jobs</h1>
          <p className="text-sm text-muted">
            {jobs.length} open {jobs.length === 1 ? 'job' : 'jobs'}
            {q ? ` matching “${q}”` : ''}
            {pipeline
              ? ` — ${pipeline.active} in the workshop, ${pipeline.invoiced} awaiting payment`
              : ' — in the workshop or awaiting payment'}
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
              <option value="all">All open jobs</option>
              {OPEN_STATUSES.map((value) => (
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

      {/* Points at the other half of the split rather than leaving a dead end.
          Shown whenever settled jobs match, including with no search at all, so
          the Paid jobs page is discoverable from the list it was carved out of. */}
      {settledMatches > 0 ? (
        <p className="text-sm text-muted">
          {settledMatches === 1
            ? `1 paid job ${q ? 'also matches and ' : ''}is filed under `
            : `${settledMatches} paid jobs ${q ? 'also match and ' : ''}are filed under `}
          <Link
            href={q ? `/paid-jobs?q=${encodeURIComponent(q)}` : '/paid-jobs'}
            className="font-medium text-brand-dark hover:underline"
          >
            Paid jobs
          </Link>
          .
        </p>
      ) : null}

      <Card>
        {jobs.length === 0 ? (
          <Empty>
            {q || status !== 'all'
              ? 'No open jobs match that search.'
              : 'No open jobs. Create one to get started.'}
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
