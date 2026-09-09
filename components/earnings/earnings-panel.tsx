'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { ExpenseForm } from '@/components/expenses/expense-form';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { getBooksMonthDetail } from '@/lib/actions/earnings';
import { attachExpenseReceipt, reverseExpense } from '@/lib/actions/expenses';
import type { BooksMonthDetail, BooksMonthLine, BooksSummary } from '@/lib/db/queries/books';
import { formatEur } from '@/lib/money';
import { cn } from '@/lib/utils';

type MonthState = 'loading' | BooksMonthDetail;

function GroupTitle({ children }: { children: string }) {
  return <p className="px-4 pt-3 text-xs font-medium text-muted">{children}</p>;
}

/**
 * One expense line: label + amount, a Correction badge on reversal rows, a
 * Correct button that writes the cancelling row, and receipt view/upload.
 * Receipt links are plain anchors to the signed-redirect route — no JS popup,
 * so they work in the installed PWA where window.open is blocked.
 */
function ExpenseRow({
  line,
  onChanged,
}: {
  line: BooksMonthLine;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleCorrect() {
    if (!window.confirm('Record a correction that cancels this expense?')) return;
    setBusy(true);
    setError(null);
    const result = await reverseExpense(line.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not correct the expense.');
      return;
    }
    onChanged();
  }

  async function handleReceiptFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const mimeType = file.type || 'application/octet-stream';
      const urlResponse = await fetch('/api/attachments/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'expense-receipt',
          expenseId: line.id,
          fileName: file.name,
          mimeType,
        }),
      });
      if (!urlResponse.ok) throw new Error('Could not start the receipt upload.');
      const { uploadUrl, storagePath } = (await urlResponse.json()) as {
        uploadUrl: string;
        storagePath: string;
      };
      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: file,
      });
      if (!putResponse.ok) throw new Error('Receipt upload failed.');
      const result = await attachExpenseReceipt(line.id, storagePath);
      if (!result.ok) throw new Error(result.error ?? 'Could not attach the receipt.');
      onChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Receipt upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <li id={`expense-${line.id}`} className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm text-ink">{line.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2">
            {line.reversesId !== null ? <Badge value="Correction" /> : null}
            {line.hasReceipt ? (
              <a
                href={`/api/expenses/${line.id}/receipt`}
                className="text-xs text-brand-dark hover:underline"
              >
                View receipt
              </a>
            ) : (
              <button
                type="button"
                className="text-xs text-brand-dark hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Add receipt
              </button>
            )}
            {line.reversesId === null ? (
              <button
                type="button"
                className="text-xs text-muted hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void handleCorrect()}
              >
                {busy ? 'Working…' : 'Correct'}
              </button>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-sm tabular text-ink">{formatEur(line.cents)}</span>
      </span>
      <input
        ref={fileRef}
        type="file"
        className="visually-hidden"
        aria-label={`Receipt for ${line.label}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleReceiptFile(file);
        }}
      />
      {error ? <Alert>{error}</Alert> : null}
    </li>
  );
}

/**
 * One month, collapsed by default. `<details>`/`<summary>` rather than a
 * hand-rolled button + state, matching `job-form.tsx`'s `Section` — works
 * before hydration and gets keyboard/screen-reader behaviour for free.
 * `onFirstOpen` fires the lazy fetch on first open only; the result is cached
 * in the parent's `detail` map so re-collapsing and re-expanding never
 * re-fetches.
 */
function MonthRow({
  monthKey,
  label,
  profitCents,
  detail,
  onFirstOpen,
  onChanged,
}: {
  monthKey: string;
  label: string;
  profitCents: number;
  detail: MonthState | undefined;
  onFirstOpen: (monthKey: string) => void;
  onChanged: (monthKey: string) => void;
}) {
  return (
    <details
      className="group"
      onToggle={(event) => {
        if (event.currentTarget.open && detail === undefined) onFirstOpen(monthKey);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-canvas [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-ink">{label}</span>
        <span className="flex items-center gap-2">
          <span className={cn('tabular text-ink', profitCents < 0 && 'text-muted')}>
            {formatEur(profitCents)}
          </span>
          <ChevronDown
            aria-hidden
            className="size-4 text-muted transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        {detail === undefined || detail === 'loading' ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : detail.income.length === 0 &&
          detail.supplier.length === 0 &&
          detail.expenses.length === 0 ? (
          <p className="text-xs text-muted">Nothing recorded.</p>
        ) : (
          <div className="flex flex-col gap-1 pb-2">
            {detail.income.length > 0 ? (
              <>
                <GroupTitle>Money in</GroupTitle>
                <ul className="flex flex-col gap-2">
                  {detail.income.map((line) => (
                    <li key={line.id} className="flex items-center justify-between gap-3">
                      <Link
                        href={line.href}
                        className="min-w-0 truncate text-sm text-brand-dark hover:underline"
                      >
                        {line.label}
                      </Link>
                      <span className="shrink-0 text-sm tabular text-ink">
                        {formatEur(line.cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {detail.supplier.length > 0 ? (
              <>
                <GroupTitle>Supplier costs</GroupTitle>
                <ul className="flex flex-col gap-2">
                  {detail.supplier.map((line) => (
                    <li key={line.id} className="flex items-center justify-between gap-3">
                      <Link
                        href={line.href}
                        className="min-w-0 truncate text-sm text-brand-dark hover:underline"
                      >
                        {line.label}
                      </Link>
                      <span className="shrink-0 text-sm tabular text-ink">
                        {formatEur(line.cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {detail.expenses.length > 0 ? (
              <>
                <GroupTitle>Expenses</GroupTitle>
                <ul className="flex flex-col gap-3">
                  {detail.expenses.map((line) => (
                    <ExpenseRow key={line.id} line={line} onChanged={() => onChanged(monthKey)} />
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}

export function EarningsPanel({ summary }: { summary: BooksSummary }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Record<string, MonthState>>({});

  function loadMonth(monthKey: string) {
    setDetail((prev) => ({ ...prev, [monthKey]: 'loading' }));
    void getBooksMonthDetail(monthKey).then((lines) => {
      setDetail((prev) => ({ ...prev, [monthKey]: lines }));
    });
  }

  function handleSaved() {
    // The server-rendered summary (cards + month totals) refreshes from the
    // server; open months re-fetch so new and corrected lines appear at once.
    router.refresh();
    for (const key of Object.keys(detail)) loadMonth(key);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 items-stretch gap-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-muted">In, this year</p>
            <p className="mt-1 text-2xl font-semibold text-ink tabular">
              {formatEur(summary.yearToDateIncomeCents)}
            </p>
            <p className="mt-1 text-xs text-muted">Cash received</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-muted">Out, this year</p>
            <p className="mt-1 text-2xl font-semibold text-ink tabular">
              {formatEur(summary.yearToDateOutCents)}
            </p>
            <p className="mt-1 text-xs text-muted">Supplier costs + expenses</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <p className="text-xs font-medium text-muted">Profit, this year</p>
          <p className="mt-1 text-2xl font-semibold text-ink tabular">
            {formatEur(summary.yearToDateProfitCents)}
          </p>
          <p className="mt-1 text-xs text-muted">In minus out</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Monthly" description="Income by work month, costs by spent month" />
        {summary.months.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No books recorded yet.</p>
        ) : (
          <div className={cn('flex flex-col divide-y divide-line')}>
            {summary.months.map((month) => (
              <MonthRow
                key={month.key}
                monthKey={month.key}
                label={month.label}
                profitCents={month.profitCents}
                detail={detail[month.key]}
                onFirstOpen={loadMonth}
                onChanged={loadMonth}
              />
            ))}
          </div>
        )}
      </Card>

      <ExpenseForm onSaved={handleSaved} />

      <div className="flex justify-start">
        <Button variant="ghost" onClick={handleSaved}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
