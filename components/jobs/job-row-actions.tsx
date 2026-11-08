'use client';

import { MoreHorizontal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useToast } from '@/components/providers/toast-provider';
import { Alert, Button, LinkButton, Select } from '@/components/ui';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { changeJobStatus, softDeleteJob } from '@/lib/actions/jobs';
import type { JobStatus } from '@/lib/db/schema';
import { JOB_STATUS_LABELS } from '@/lib/validation/job';

/**
 * `paid` is left out on purpose: it means money changed hands and can only be
 * set by recording the payment, which happens on the job's own page (see
 * `JobActions`). Everything else can be moved from here.
 */
const ROW_STATUSES = ['active', 'completed', 'invoiced'] as const;

/**
 * The quick actions for one job on the Jobs list: open it, change its status,
 * or delete it. A bottom sheet on a phone, the usual centred pop-up on a wide
 * screen. Uses the same server actions as the job page, so every rule that
 * applies there applies here.
 */
export function JobRowActions({
  jobId,
  jobNumber,
  status,
}: {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
  }

  function handleStatusChange(next: string) {
    if (next === status) return;
    setError(null);
    startTransition(async () => {
      const result = await changeJobStatus(jobId, next);
      if (!result.ok) {
        const message = result.error ?? 'Could not update the status.';
        setError(message);
        toast.error('Could not change status', message);
        return;
      }
      toast.success(`${jobNumber} updated`, `Status set to ${JOB_STATUS_LABELS[next as JobStatus]}.`);
      close();
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
        const message = result.error ?? 'Could not delete the job.';
        setError(message);
        toast.error('Could not delete job', message);
        return;
      }
      toast.success('Job deleted', `${jobNumber} is hidden from all lists.`);
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`Actions for ${jobNumber}`}>
        <MoreHorizontal aria-hidden className="size-4" />
        Actions
      </Button>

      <ResponsiveModal open={open} onClose={close} label={`Actions for ${jobNumber}`}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{jobNumber}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-canvas"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {error ? <Alert>{error}</Alert> : null}

          <LinkButton href={`/jobs/${jobId}`} className="justify-center">
            Open job
          </LinkButton>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`job-status-${jobId}`} className="text-xs font-medium text-ink">
              Status
            </label>
            <Select
              id={`job-status-${jobId}`}
              value={status}
              disabled={pending}
              onChange={(event) => handleStatusChange(event.target.value)}
            >
              {ROW_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {JOB_STATUS_LABELS[value]}
                </option>
              ))}
              {status === 'paid' ? <option value="paid">{JOB_STATUS_LABELS.paid}</option> : null}
            </Select>
            <p className="text-xs text-muted">To mark a job paid, open it and record the payment.</p>
          </div>

          <Button variant="danger" onClick={handleDelete} disabled={pending}>
            Delete job
          </Button>
        </div>
      </ResponsiveModal>
    </>
  );
}
