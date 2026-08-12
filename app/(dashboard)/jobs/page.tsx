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
import { listJobs } from '@/lib/db/queries/jobs';
import { formatDate } from '@/lib/format';
import { JOB_STATUSES } from '@/lib/validation/job';
import type { JobStatus } from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

export default async function JobsPage({ searchParams }: PageProps<'/jobs'>) {
  const params = await searchParams;

  const q = typeof params.q === 'string' ? params.q : undefined;
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const status = (JOB_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as JobStatus)
    : 'all';

  const jobs = await listJobs({ q, status });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Jobs</h1>
          <p className="text-sm text-muted">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
            {q ? ` matching “${q}”` : ''}
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
              <option value="all">All statuses</option>
              {JOB_STATUSES.map((value) => (
                <option key={value} value={value} className="capitalize">
                  {value}
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

      <Card>
        {jobs.length === 0 ? (
          <Empty>No jobs found. Create one to get started.</Empty>
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
                  <Td>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-brand-dark hover:underline"
                    >
                      {job.jobNumber}
                    </Link>
                  </Td>
                  <Td>
                    <div>{job.customerName}</div>
                    {job.customerPhone ? (
                      <div className="text-xs text-muted">{job.customerPhone}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="font-medium">{job.vehicleRegistration}</div>
                    <div className="text-xs text-muted">
                      {[job.vehicleMake, job.vehicleModel].filter(Boolean).join(' ') || '—'}
                    </div>
                  </Td>
                  <Td>
                    <Badge value={job.status} />
                  </Td>
                  <Td>
                    <Badge value={job.priority} />
                  </Td>
                  <Td className="text-muted">{formatDate(job.dueDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
