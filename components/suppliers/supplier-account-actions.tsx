'use client';

import { Minus, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { PaymentForm } from '@/components/payments/payment-form';
import { ChargeForm } from '@/components/suppliers/charge-form';
import { Alert, Button } from '@/components/ui';
import { recordSupplierPayment } from '@/lib/actions/suppliers';
import { formatEur } from '@/lib/money';

/**
 * The two ways a supplier account moves: money on, money off.
 *
 * They sit together because that is the whole account — there are no
 * individual bills to act on any more, so both buttons belong to the account
 * as a whole rather than to any one line of it.
 *
 * Both modals are built here rather than in `components/ui/index.tsx`: that
 * barrel has no `'use client'` by design, so a shared Modal living there would
 * drag every consumer app-wide into being client-side. Same reasoning and the
 * same shape as `components/settings/time-off.tsx`.
 *
 * Paying re-uses `PaymentForm` — the same full/partial control the job side
 * uses, so "paid in full" and "partial payment" cannot come to mean two
 * different things depending on which direction the money is going.
 */
export function SupplierAccountActions({
  supplierId,
  supplierName,
  balanceCents,
}: {
  supplierId: string;
  supplierName: string;
  /** Signed: negative means the supplier is holding a credit. */
  balanceCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'charge' | 'payment' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(null);
    setError(null);
  }

  function pay(payment: { payInFull: true } | { amount: string }) {
    setError(null);
    startTransition(async () => {
      const result = await recordSupplierPayment(supplierId, payment);
      if (!result.ok) {
        setError(result.error ?? 'Could not record the payment.');
        return;
      }
      close();
      router.refresh();
    });
  }

  /*
    Nothing is owed, so there is no "in full" figure to offer — that button
    would read EUR 0.00 and be refused on submit. Money can still legitimately
    go onto the account ahead of the dockets, so the form asks straight for an
    amount instead of a dead choice.
  */
  const nothingOwed = balanceCents <= 0;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => setOpen('charge')}>
          <Plus aria-hidden className="size-4" />
          Add to bill
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen('payment')}>
          <Minus aria-hidden className="size-4" />
          Mark paid
        </Button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              open === 'charge'
                ? `Add a purchase to ${supplierName}`
                : `Record a payment to ${supplierName}`
            }
            className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                {open === 'charge' ? 'Add to the bill' : 'Money paid off the bill'}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-md p-1 text-muted hover:bg-canvas"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {open === 'charge' ? (
              <ChargeForm supplierId={supplierId} onSaved={close} onCancel={close} />
            ) : (
              <div className="flex flex-col gap-3 p-4">
                <p className="text-xs text-muted">
                  {nothingOwed
                    ? `Nothing is outstanding with ${supplierName} right now. Anything recorded here is carried as a credit against their next purchase.`
                    : `${formatEur(balanceCents)} is on ${supplierName}'s bill. A part payment leaves the rest owing.`}
                </p>

                {error ? <Alert>{error}</Alert> : null}

                <PaymentForm
                  remainingCents={balanceCents}
                  subject={supplierName}
                  pending={pending}
                  onSubmit={pay}
                  onCancel={close}
                  amountOnly={nothingOwed}
                  fullLabel="Pay the bill off"
                />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
