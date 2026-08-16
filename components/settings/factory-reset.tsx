'use client';

import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { factoryReset, type ResetResult } from '@/lib/actions/danger';
import { RESET_CONFIRMATION_PHRASE } from '@/lib/validation/danger';

export interface ResetCounts {
  jobs: number;
  invoices: number;
  attachments: number;
  suppliers: number;
  supplierBills: number;
  payments: number;
}

/**
 * Destructive reset, behind three separate speed bumps: it has to be revealed,
 * then an exact phrase typed, and the phrase is re-checked on the server. The
 * counts are shown live so the owner can see exactly what they are about to
 * destroy rather than trusting a generic warning.
 */
export function FactoryReset({ counts }: { counts: ResetCounts }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ResetResult['deleted'] | null>(null);
  const [pending, startTransition] = useTransition();

  const total =
    counts.jobs +
    counts.invoices +
    counts.attachments +
    counts.suppliers +
    counts.supplierBills +
    counts.payments;
  const isEmpty = total === 0;
  const phraseMatches = phrase.trim() === RESET_CONFIRMATION_PHRASE;

  function handleReset() {
    setError(null);

    startTransition(async () => {
      const result = await factoryReset(phrase);

      if (!result.ok) {
        setError(result.error ?? 'The reset could not be completed.');
        return;
      }

      setDone(result.deleted ?? null);
      setArmed(false);
      setPhrase('');
      router.refresh();
    });
  }

  return (
    <Card className="border-danger/40">
      <CardHeader
        title={<span className="text-danger">Danger zone</span>}
        description="Clear every job, invoice, customer and supplier record."
      />

      <CardBody className="flex flex-col gap-4">
        {done ? (
          <Alert tone="ok">
            Dashboard reset. Removed {done.jobs} {done.jobs === 1 ? 'job' : 'jobs'},{' '}
            {done.invoices} {done.invoices === 1 ? 'invoice' : 'invoices'}, {done.payments}{' '}
            {done.payments === 1 ? 'payment' : 'payments'}, {done.suppliers}{' '}
            {done.suppliers === 1 ? 'supplier' : 'suppliers'}, {done.supplierBills}{' '}
            {done.supplierBills === 1 ? 'bill' : 'bills'} and {done.filesRemoved}{' '}
            {done.filesRemoved === 1 ? 'file' : 'files'}. Numbering restarts at J-0001 and
            NA-0001.
          </Alert>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}

        <div className="rounded-md border border-line bg-canvas p-3">
          <p className="text-xs font-medium text-muted">Currently stored</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <li className="flex justify-between gap-2">
              <span className="text-muted">Jobs</span>
              <span className="font-medium tabular">{counts.jobs}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Invoices</span>
              <span className="font-medium tabular">{counts.invoices}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Attachments</span>
              <span className="font-medium tabular">{counts.attachments}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Suppliers</span>
              <span className="font-medium tabular">{counts.suppliers}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Supplier bills</span>
              <span className="font-medium tabular">{counts.supplierBills}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Payments recorded</span>
              <span className="font-medium tabular">{counts.payments}</span>
            </li>
          </ul>
        </div>

        {!armed ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="danger"
              disabled={isEmpty}
              onClick={() => {
                setArmed(true);
                setDone(null);
              }}
            >
              <AlertTriangle aria-hidden className="size-4" />
              Reset all data…
            </Button>
            {isEmpty ? (
              <p className="text-xs text-muted">
                There is nothing to reset — the dashboard is already empty.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger-soft p-3">
            <div className="flex gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="text-sm text-danger">
                <p className="font-semibold">This permanently deletes everything listed above.</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
                  <li>Every job, including customer names, addresses and phone numbers.</li>
                  <li>Every invoice and its stored PDF.</li>
                  <li>Every payment recorded against an invoice.</li>
                  <li>Every supplier and every bill.</li>
                  <li>All uploaded photos and receipts.</li>
                  <li>
                    Job and invoice numbering restarts — the next invoice will be{' '}
                    <strong>NA-0001</strong> again.
                  </li>
                </ul>
                <p className="mt-2">
                  It cannot be undone. Only do this to clear test data{' '}
                  <strong>before</strong> issuing real invoices — reusing an invoice number that a
                  customer has already received breaks the sequence Revenue expects.
                </p>
                <p className="mt-2">
                  Your business details, VAT settings and hourly rate are kept.
                </p>
              </div>
            </div>

            <Field
              label={`Type ${RESET_CONFIRMATION_PHRASE} to confirm`}
              htmlFor="reset-confirm"
            >
              <Input
                id="reset-confirm"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={RESET_CONFIRMATION_PHRASE}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button variant="danger" disabled={!phraseMatches || pending} onClick={handleReset}>
                {pending ? 'Resetting…' : 'Permanently delete everything'}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setArmed(false);
                  setPhrase('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
