'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { PaymentForm } from '@/components/payments/payment-form';
import { Alert, Button, LinkButton } from '@/components/ui';
import { recordPayment } from '@/lib/actions/payments';

/**
 * Opened when the job page's status dropdown is set to `paid`.
 *
 * Deliberately a hard stop rather than a hint. `paid` is the one status that
 * means money changed hands, and Earnings counts the `payments` table, so
 * letting the status be set without recording a payment would make that money
 * invisible everywhere — which is exactly the bug this whole change closes.
 * `changeJobStatus` refuses `paid` outright; this is the flow that replaces it.
 *
 * A real modal, built here rather than in `components/ui/index.tsx` — that
 * barrel has no `'use client'` by design, so a shared Modal living there would
 * force every consumer app-wide to become client-side. Same reasoning, and the
 * same shape, as `components/settings/time-off.tsx`.
 *
 * No backdrop-click, no Escape, no X: the only ways out are recording a payment
 * or the explicit Cancel, which leaves the status untouched. A misclick on the
 * dropdown stays recoverable without offering a silent way to skip the money.
 */
export function MarkPaidModal({
  invoice,
  jobNumber,
  onClose,
}: {
  /** `null` when the job has no live invoice — there is no amount to pay against. */
  invoice: { id: string; remainingCents: number } | null;
  jobNumber: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(payment: { payInFull: true } | { amount: string }) {
    if (!invoice) return;
    setError(null);
    startTransition(async () => {
      const result = await recordPayment(invoice.id, payment);
      if (!result.ok) {
        setError(result.error ?? 'Could not record the payment.');
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record payment for ${jobNumber}`}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-4 shadow-lg"
      >
        <h2 className="text-sm font-semibold text-ink">Record the payment</h2>

        {invoice ? (
          <>
            <p className="mt-1 text-xs text-muted">
              {jobNumber} is marked paid by recording the money, so it shows up in Earnings. A
              partial payment leaves the job awaiting the balance.
            </p>
            {error ? (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            ) : null}
            <div className="mt-3">
              <PaymentForm
                remainingCents={invoice.remainingCents}
                jobNumber={jobNumber}
                pending={pending}
                onSubmit={submit}
                onCancel={onClose}
                cancelLabel="Cancel — leave status unchanged"
              />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {jobNumber} has no invoice yet, so there is no amount to pay against. Generate the
              invoice first, then record the payment.
            </p>
            <div className="mt-3 flex flex-col items-stretch gap-1.5">
              <LinkButton href="/invoicer" size="sm" className="justify-center">
                Go to Invoicer
              </LinkButton>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel — leave status unchanged
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
