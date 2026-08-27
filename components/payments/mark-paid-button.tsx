'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { PaymentForm } from '@/components/payments/payment-form';
import { Alert, Button } from '@/components/ui';
import { recordPayment } from '@/lib/actions/payments';

/**
 * Armed inline reveal, matching `components/settings/factory-reset.tsx`'s
 * established pattern — not a modal/dialog. `components/ui/index.tsx` has no
 * `'use client'` directive by design (it keeps the whole dashboard
 * renderable as Server Components), so a `<dialog>`-based Modal added there
 * would force every component in that barrel to become client-side at every
 * import site app-wide. This button already lives in its own client
 * component with its own state, so the reveal happens right here instead.
 */
export function MarkPaidButton({
  invoiceId,
  jobNumber,
  remainingCents,
}: {
  invoiceId: string;
  jobNumber: string;
  remainingCents: number;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setArmed(false);
    setError(null);
  }

  function submit(payment: { payInFull: true } | { amount: string }) {
    setError(null);
    startTransition(async () => {
      const result = await recordPayment(invoiceId, payment);
      if (!result.ok) {
        setError(result.error ?? 'Could not record the payment.');
        return;
      }
      reset();
      router.refresh();
    });
  }

  if (!armed) {
    return (
      <Button size="sm" onClick={() => setArmed(true)}>
        Mark as paid
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <Alert>{error}</Alert> : null}
      <PaymentForm
        remainingCents={remainingCents}
        subject={jobNumber}
        pending={pending}
        onSubmit={submit}
        onCancel={reset}
      />
    </div>
  );
}
