'use client';

import { useState } from 'react';

import { Button, Input } from '@/components/ui';
import { formatEur } from '@/lib/money';

/**
 * The full/partial payment choice, extracted from `mark-paid-button.tsx` so
 * every place money is recorded offers the same two ways of paying and the
 * same validation. It is used by both sides of the ledger now — invoices the
 * garage is owed, and supplier accounts the garage owes — which is exactly
 * why it is one component: "pay it all" and "pay some of it" must not come to
 * mean different things depending on which screen you are on.
 *
 * Presentation only: it reports a chosen payment upward and never talks to a
 * server action, so each caller keeps its own pending/error handling and its
 * own idea of what "cancel" means.
 */
export function PaymentForm({
  remainingCents,
  subject,
  pending,
  onSubmit,
  onCancel,
  cancelLabel = 'Cancel',
  amountOnly = false,
  fullLabel = 'Paid in full',
}: {
  remainingCents: number;
  /** What is being paid, for the amount field's label. A job or a supplier. */
  subject: string;
  pending: boolean;
  onSubmit: (payment: { payInFull: true } | { amount: string }) => void;
  onCancel: () => void;
  cancelLabel?: string;
  /**
   * Skip the choice and ask straight for an amount. A supplier account that
   * is level or in credit has no "in full" to offer — the figure on that
   * button would be EUR 0.00 — but money can still be paid onto it.
   */
  amountOnly?: boolean;
  fullLabel?: string;
}) {
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');

  if (!partial && !amountOnly) {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <Button size="sm" onClick={() => onSubmit({ payInFull: true })} disabled={pending}>
          {pending ? 'Saving…' : `${fullLabel} — ${formatEur(remainingCents)}`}
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
        aria-label={`Amount paid for ${subject}`}
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          onClick={() => onSubmit({ amount })}
          disabled={pending || amount.trim() === ''}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {/* With no choice screen behind it, "Back" would go nowhere. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (amountOnly ? onCancel() : setPartial(false))}
          disabled={pending}
        >
          {amountOnly ? cancelLabel : 'Back'}
        </Button>
      </div>
    </div>
  );
}
