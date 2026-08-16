'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge, Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface InvoiceableJob {
  id: string;
  jobNumber: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  vehicleRegistration: string;
  status: string;
  labourLines: { description: string; hours: string }[];
  hourlyRate: string | null;
  labourTotalOverride: string | null;
  parts: { partName: string; partNumber: string; qty: string; unitPrice: string }[];
  otherComments: string | null;
  /** Set when the job already has a NON-voided invoice — the re-send path. */
  liveInvoiceId: string | null;
  liveInvoiceNumber: string | null;
}

/**
 * Searchable job picker.
 *
 * The candidate list is small (a single workshop's open jobs) and is fetched
 * once on the server, so filtering happens in memory — no debounced search
 * endpoint, no loading states, and it keeps working on a bad workshop
 * connection once the page has loaded.
 */
export function JobPicker({
  jobs,
  selected,
  onSelect,
  disabled,
}: {
  jobs: InvoiceableJob[];
  selected: InvoiceableJob | null;
  onSelect: (job: InvoiceableJob | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return jobs.slice(0, 12);

    return jobs
      .filter(
        (job) =>
          job.jobNumber.toLowerCase().includes(term) ||
          job.customerName.toLowerCase().includes(term) ||
          job.vehicleRegistration.toLowerCase().includes(term),
      )
      .slice(0, 12);
  }, [jobs, query]);

  if (selected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-canvas px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {selected.jobNumber} — {selected.customerName}
          </p>
          <p className="text-xs text-muted">{selected.vehicleRegistration}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge value={selected.status} />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setQuery('');
              onSelect(null);
            }}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by job number or customer name"
          className="pl-9"
          aria-label="Search jobs"
        />
      </div>

      {jobs.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted">
          No jobs available to invoice. Create a job first.
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto rounded-md border border-line">
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">No jobs match “{query}”.</li>
          ) : (
            matches.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelect(job)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left last:border-b-0',
                    'hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">
                      {job.jobNumber} — {job.customerName}
                    </span>
                    <span className="block text-xs text-muted">
                      {job.vehicleRegistration}
                      {job.liveInvoiceNumber ? ` · ${job.liveInvoiceNumber}` : ''}
                    </span>
                  </span>
                  <Badge value={job.status} />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
