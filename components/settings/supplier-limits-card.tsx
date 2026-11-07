'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useToast } from '@/components/providers/toast-provider';
import { SupplierLimitBar } from '@/components/suppliers/limit-bar';
import { Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { clearSupplierLimit, setSupplierLimit } from '@/lib/actions/suppliers';
import { formatEur } from '@/lib/money';
import { limitProgress } from '@/lib/supplier-limit-progress';

export type SupplierLimitRow = {
  id: string;
  name: string;
  /** Signed: negative means the supplier is holding a credit. */
  balanceCents: number;
  /** Null when no limit has been set. */
  limitCents: number | null;
};

/**
 * The one place a supplier's rough limit is set. Every supplier is listed, read
 * fresh from the database on each visit, so a supplier added or removed on the
 * Suppliers page appears or disappears here with nothing to maintain by hand.
 *
 * A limit is a guide for the owner, not a cap: it never blocks a purchase and
 * the bill can go past it. Phone alerts fire at 80% and at the limit (only for
 * devices with "Supplier balances" switched on above).
 *
 * Built only from the app's existing card, field, input and button components.
 */
export function SupplierLimitsCard({ rows }: { rows: SupplierLimitRow[] }) {
  return (
    <Card>
      <CardHeader
        title="Supplier Balance Limit"
        description="A rough guide for when to stop spending with a supplier. It never blocks a purchase and can be gone over. We notify you at 80% and again when it is reached."
      />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">
            No suppliers yet. Add one on the{' '}
            <Link href="/suppliers" className="font-medium text-brand-dark hover:underline">
              Owed to others
            </Link>{' '}
            page and it will appear here.
          </p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            // Keyed on the saved limit too, so after a save the input shows what
            // is stored rather than what was typed.
            <LimitRow key={`${row.id}:${row.limitCents ?? 'none'}`} row={row} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LimitRow({ row }: { row: SupplierLimitRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(row.limitCents === null ? '' : (row.limitCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);

  const progress = limitProgress(row.balanceCents, row.limitCents);
  const inputId = `supplierLimit-${row.id}`;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setSupplierLimit(row.id, value.trim());
      if (!result.ok) {
        setError(result.error ?? 'Could not save the limit.');
        return;
      }
      toast.success('Limit saved', `${row.name}: you will be notified at 80% and when it is reached.`);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await clearSupplierLimit(row.id);
      if (!result.ok) {
        setError(result.error ?? 'Could not remove the limit.');
        return;
      }
      toast.success('Limit removed', `No more alerts for ${row.name}.`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Link
          href={`/suppliers/${row.id}`}
          className="text-sm font-medium text-brand-dark hover:underline"
        >
          {row.name}
        </Link>
        <span className="text-xs text-muted tabular">
          {row.balanceCents < 0
            ? `${formatEur(Math.abs(row.balanceCents))} in credit`
            : `${formatEur(row.balanceCents)} on the bill`}
          {row.limitCents !== null ? ` of ${formatEur(row.limitCents)}` : ''}
        </span>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field label="Limit (€)" htmlFor={inputId} error={error ?? undefined} className="w-44">
          <Input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 5000"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" disabled={pending || value.trim() === ''}>
          {pending ? 'Saving…' : row.limitCents === null ? 'Set limit' : 'Save limit'}
        </Button>
        {row.limitCents !== null ? (
          <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={pending}>
            Remove limit
          </Button>
        ) : null}
      </form>

      {progress ? (
        <div className="flex flex-col gap-1">
          <SupplierLimitBar balanceCents={row.balanceCents} limitCents={row.limitCents} />
          {progress.overByCents > 0 ? (
            <p className="text-xs text-muted tabular">Over the limit by {formatEur(progress.overByCents)}.</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
