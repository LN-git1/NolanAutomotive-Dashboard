'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { loadVehicleHistory } from '@/lib/actions/jobs';
import type { VehicleHistoryEntry, VehicleMatch } from '@/lib/db/queries/vehicles';
import { formatDate } from '@/lib/format';
import { formatEur } from '@/lib/money';

/**
 * What this car has cost its owner, shown the moment one is picked.
 *
 * The point is the conversation that happens at the counter: "this is the third
 * time that clutch has been back" or "you've had EUR 1,400 through here this
 * year". Those are answerable from the jobs already in the database, and until
 * now the only way to ask was to search the job list by hand and add the
 * invoices up.
 *
 * The three headline figures come from the search result that is already in
 * hand, so they render immediately. Only the job-by-job breakdown — behind a
 * disclosure, because most of the time the totals are the whole answer — costs
 * a round trip, and only for the vehicle actually chosen.
 *
 * The caller keys this on the vehicle, so picking a different car remounts it
 * and the loaded jobs reset with it. That matters more than it looks: a stale
 * list here would be one car's repair history shown under another car's plate.
 */
export function VehicleHistory({ vehicle }: { vehicle: VehicleMatch }) {
  const [entries, setEntries] = useState<VehicleHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || entries || loading) return;

    setLoading(true);
    try {
      setEntries(await loadVehicleHistory(vehicle.registration));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const owed = vehicle.totalBilledCents - vehicle.totalPaidCents;

  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2.5">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-muted">Jobs</dt>
          <dd className="text-sm font-semibold text-ink tabular">{vehicle.jobCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Total billed</dt>
          <dd className="text-sm font-semibold text-ink tabular">
            {formatEur(vehicle.totalBilledCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{owed > 0 ? 'Still owed' : 'Paid'}</dt>
          <dd className="text-sm font-semibold text-ink tabular">
            {formatEur(owed > 0 ? owed : vehicle.totalPaidCents)}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-center text-xs text-muted">
        {vehicle.jobCount === 1
          ? `First in ${formatDate(vehicle.firstVisit)}`
          : `${formatDate(vehicle.firstVisit)} — ${formatDate(vehicle.lastVisit)}`}
      </p>

      <details onToggle={toggle} className="group mt-1">
        <summary className="flex cursor-pointer list-none items-center justify-center gap-1 py-1 text-xs font-medium text-brand-dark [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-90"
          />
          Previous jobs
        </summary>

        <div className="mt-1 border-t border-line pt-2">
          {loading ? <p className="text-xs text-muted">Loading…</p> : null}
          {failed ? <p className="text-xs text-muted">Could not load the history.</p> : null}
          {entries?.length === 0 ? <p className="text-xs text-muted">No previous jobs.</p> : null}

          {entries && entries.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <Link
                    href={`/jobs/${entry.id}`}
                    target="_blank"
                    className="font-medium text-brand-dark hover:underline"
                  >
                    {entry.jobNumber}
                  </Link>
                  <span className="flex-1 truncate text-muted">
                    {formatDate(entry.dueDate ?? entry.createdAt)}
                  </span>
                  <span className="shrink-0 text-ink tabular">
                    {entry.billedCents > 0 ? formatEur(entry.billedCents) : 'Not invoiced'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </div>
  );
}
