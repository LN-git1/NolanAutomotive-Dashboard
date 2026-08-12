'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui';
import { markJobPaid } from '@/lib/actions/jobs';

/**
 * Payment is recorded manually — the brief is explicit that a job stays
 * Invoiced until the owner says otherwise, so there is no automatic transition.
 */
export function MarkPaidButton({ jobId, jobNumber }: { jobId: string; jobNumber: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(`Mark ${jobNumber} as paid?`)) return;

    startTransition(async () => {
      const result = await markJobPaid(jobId);
      if (!result.ok) {
        setError(result.error ?? 'Could not update the job.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleClick} disabled={pending}>
        {pending ? 'Saving…' : 'Mark as paid'}
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
