'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { MarkPaidModal } from '@/components/payments/mark-paid-modal';
import { Alert, Button, Select } from '@/components/ui';
import { changeJobStatus, softDeleteJob } from '@/lib/actions/jobs';
import { JOB_STATUSES } from '@/lib/validation/job';
import type { JobStatus } from '@/lib/db/schema';

/**
 * Status can be moved to any value at any time — the workshop does not always
 * follow the happy path, and the brief explicitly allows manual changes.
 *
 * The one exception is `paid`, which means money changed hands. Earnings sums
 * the `payments` table, so a bare status flip would claim a job was settled
 * while contributing nothing; `changeJobStatus` refuses it and this component
 * opens `MarkPaidModal` to capture the actual payment instead.
 */
export function JobActions({
  jobId,
  jobNumber,
  status,
  liveInvoice,
}: {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
  liveInvoice: { id: string; remainingCents: number } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [payingOpen, setPayingOpen] = useState(false);

  function handleStatusChange(next: string) {
    if (next === status) return;
    setError(null);

    // `paid` never goes through changeJobStatus — the server refuses it, because
    // money has to be recorded and that is what flips the status. The <select>
    // is controlled by `status`, so React snaps it back on its own when the
    // modal closes without a payment; there is nothing to reset by hand.
    if (next === 'paid') {
      setPayingOpen(true);
      return;
    }

    startTransition(async () => {
      const result = await changeJobStatus(jobId, next);
      if (!result.ok) {
        setError(result.error ?? 'Could not update the status.');
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (
      !window.confirm(
        'Delete this job? It will be hidden from all lists. Any invoice already issued against it is retained for tax records.',
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await softDeleteJob(jobId);
      if (!result.ok) {
        setError(result.error ?? 'Could not delete the job.');
        return;
      }
      router.push('/jobs');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {error ? <Alert>{error}</Alert> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="job-status" className="text-xs font-medium text-ink">
          Status
        </label>
        <Select
          id="job-status"
          value={status}
          disabled={pending}
          onChange={(event) => handleStatusChange(event.target.value)}
        >
          {JOB_STATUSES.map((value) => (
            <option key={value} value={value} className="capitalize">
              {value}
            </option>
          ))}
        </Select>
      </div>

      <Button variant="danger" onClick={handleDelete} disabled={pending}>
        Delete job
      </Button>

      {payingOpen ? (
        <MarkPaidModal
          invoice={liveInvoice}
          jobNumber={jobNumber}
          onClose={() => setPayingOpen(false)}
        />
      ) : null}
    </div>
  );
}
