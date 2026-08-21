'use client';

import { useState } from 'react';

import { Button, Input } from '@/components/ui';
import { formatEur } from '@/lib/money';

/**
 * The full/partial payment choice, extracted from `mark-paid-button.tsx` so the
 * inline Awaiting Payments button and the job page's forced modal cannot drift
 * apart — they must offer the same two ways of paying and the same validation,
 * because they write to the same ledger.
 *
 * Presentation only: it reports a chosen payment upward and never talks to a
 * server action, so each caller keeps its own pending/error handling and its
 * own idea of what "cancel" means.
 */
export function PaymentForm({
  remainingCents,
  jobNumber,
  pending,
  onSubmit,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  remainingCents: number;
  jobNumber: string;
  pending: boolean;
  onSubmit: (payment: { payInFull: true } | { amount: string }) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');

  if (!partial) {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <Button size="sm" onClick={() => onSubmit({ payInFull: true })} disabled={pending}>
          {pending ? 'Saving…' : `Paid in full — ${formatEur(remainingCents)}`}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPartial(true)} disabled={pending}>
          Partial payment
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <Input
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        className="text-right"
        aria-label={`Amount paid for ${jobNumber}`}
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          onClick={() => onSubmit({ amount })}
          disabled={pending || amount.trim() === ''}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPartial(false)} disabled={pending}>
          Back
        </Button>
      </div>
    </div>
  );
}
