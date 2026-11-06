'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useToast } from '@/components/providers/toast-provider';
import { Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { clearSupplierLimit, setSupplierLimit } from '@/lib/actions/suppliers';
import { formatEur } from '@/lib/money';

/**
 * How much the garage is willing to owe this supplier. Notifications go out at
 * 80% of it and again when it is reached (only to devices with "Supplier
 * balances" switched on in Settings).
 *
 * Built only from the app's existing card, field, input and button components.
 */
export function SupplierLimitCard({
  supplierId,
  limitCents,
  balanceCents,
}: {
  supplierId: string;
  /** Null when no limit has been set. */
  limitCents: number | null;
  /** Signed: negative means the supplier is holding a credit. */
  balanceCents: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(limitCents === null ? '' : (limitCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);

  const percent =
    limitCents !== null && limitCents > 0 ? Math.max(0, Math.round((balanceCents / limitCents) * 100)) : null;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setSupplierLimit(supplierId, value.trim());
      if (!result.ok) {
        setError(result.error ?? 'Could not save the limit.');
        return;
      }
      toast.success('Limit saved', 'You will be notified at 80% and when it is reached.');
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await clearSupplierLimit(supplierId);
      if (!result.ok) {
        setError(result.error ?? 'Could not remove the limit.');
        return;
      }
      setValue('');
      toast.success('Limit removed', 'No more alerts for this supplier.');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Balance limit"
        description={
          limitCents === null
            ? 'Set the most you want to owe this supplier, at any given point. We notify you at 80% of it, and again when it is reached.'
            : `Limit ${formatEur(limitCents)}. ${percent !== null ? `The bill is at ${percent}% of it.` : ''} We notify you at 80%, and again when it is reached.`
        }
      />
      <CardBody className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Field label="Limit (€)" htmlFor="supplierLimit" error={error ?? undefined} className="w-44">
            <Input
              id="supplierLimit"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 5000"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending || value.trim() === ''}>
            {pending ? 'Saving…' : limitCents === null ? 'Set limit' : 'Save limit'}
          </Button>
          {limitCents !== null ? (
            <Button type="button" variant="ghost" onClick={remove} disabled={pending}>
              Remove limit
            </Button>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
