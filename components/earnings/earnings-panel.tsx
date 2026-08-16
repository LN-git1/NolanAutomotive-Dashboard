'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Card, CardBody, CardHeader } from '@/components/ui';
import { getEarningsMonthDetail } from '@/lib/actions/earnings';
import type { EarningsMonthInvoice, EarningsSummary } from '@/lib/db/queries/earnings';
import { formatEur, toCents } from '@/lib/money';
import { cn } from '@/lib/utils';

type MonthState = 'loading' | EarningsMonthInvoice[];

/**
 * One month, collapsed by default. `<details>`/`<summary>` rather than a
 * hand-rolled button + state, matching `job-form.tsx`'s `Section` — works
 * before hydration and gets keyboard/screen-reader behaviour for free.
 * `onToggle` fires the lazy fetch on first open only; the result is cached in
 * the parent's `detail` map so re-collapsing and re-expanding never re-fetches.
 */
function MonthRow({
  monthKey,
  label,
  totalCents,
  detail,
  onFirstOpen,
}: {
  monthKey: string;
  label: string;
  totalCents: number;
  detail: MonthState | undefined;
  onFirstOpen: (monthKey: string) => void;
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
          <span className="tabular text-ink">{formatEur(totalCents)}</span>
          <ChevronDown
            aria-hidden
            className="size-4 text-muted transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        {detail === undefined || detail === 'loading' ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : detail.length === 0 ? (
          <p className="text-xs text-muted">No invoices recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3">
                <Link
                  href={`/jobs/${invoice.jobId}`}
                  className="min-w-0 truncate text-brand-dark hover:underline"
                >
                  {invoice.jobNumber} — {invoice.customerName}
                </Link>
                <span className="shrink-0 tabular text-ink">{formatEur(toCents(invoice.grandTotal))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function EarningsPanel({ summary }: { summary: EarningsSummary }) {
  const [detail, setDetail] = useState<Record<string, MonthState>>({});

  function loadMonth(monthKey: string) {
    setDetail((prev) => ({ ...prev, [monthKey]: 'loading' }));
    void getEarningsMonthDetail(monthKey).then((invoices) => {
      setDetail((prev) => ({ ...prev, [monthKey]: invoices }));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-muted">Earned all time</p>
            <p className="mt-1 text-2xl font-semibold text-ink tabular">
              {formatEur(summary.allTimeCents)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-muted">30 day avg.</p>
            <p className="mt-1 text-2xl font-semibold text-ink tabular">
              {formatEur(summary.last30DayAvgCents)}
            </p>
            <p className="mt-1 text-xs text-muted">Paid invoices, by issue date</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Monthly" />
        {summary.months.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No earnings recorded yet.</p>
        ) : (
          <div className={cn('flex flex-col divide-y divide-line')}>
            {summary.months.map((month) => (
              <MonthRow
                key={month.key}
                monthKey={month.key}
                label={month.label}
                totalCents={month.totalCents}
                detail={detail[month.key]}
                onFirstOpen={loadMonth}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
