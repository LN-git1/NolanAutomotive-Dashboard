'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert, Button, Input } from '@/components/ui';
import { recordPayment } from '@/lib/actions/payments';
import { formatEur } from '@/lib/money';

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
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setArmed(false);
    setPartial(false);
    setAmount('');
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

      {!partial ? (
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm" onClick={() => submit({ payInFull: true })} disabled={pending}>
            {pending ? 'Saving…' : `Paid in full — ${formatEur(remainingCents)}`}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPartial(true)} disabled={pending}>
            Partial payment
          </Button>
          <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-28 text-right"
            aria-label={`Amount paid for ${jobNumber}`}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={() => submit({ amount })}
              disabled={pending || amount.trim() === ''}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPartial(false)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
