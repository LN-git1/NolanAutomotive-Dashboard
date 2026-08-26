'use client';

import { Car, Loader2, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Field, Input } from '@/components/ui';
import { searchVehicleRegistrations } from '@/lib/actions/jobs';
import type { VehicleMatch } from '@/lib/db/queries/vehicles';
import { formatDate } from '@/lib/format';
import { formatEur } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The registration box, with the workshop's own history behind it.
 *
 * A car arrives and the one thing the owner knows for certain is its plate, so
 * this is where the form starts. It used to be a plain text box that looked up
 * an EXACT registration when it lost focus, which answered the wrong question:
 * nobody remembers a full plate for a car they saw eight months ago. What they
 * remember is "it was one of the 98 Dublin ones". Typing `98D` now lists every
 * matching vehicle with what it has cost to date, and picking one fills the
 * customer and vehicle sections in.
 *
 * It stays a free-text input first and a picker second. `vehicleRegistration`
 * is required and every car has a first visit, so a selector-only field would
 * make a new customer impossible to book in. Nothing here blocks typing — the
 * suggestions are an overlay on an ordinary input, and ignoring them entirely
 * is a supported way to use the form.
 */

/** Long enough to stop firing on the first keystroke, short enough to feel live. */
const DEBOUNCE_MS = 200;

/** Below this a query matches most of the table and the list is no help. */
const MIN_CHARS = 2;

function VehicleSummary({ vehicle }: { vehicle: VehicleMatch }) {
  const visits = `${vehicle.jobCount} ${vehicle.jobCount === 1 ? 'job' : 'jobs'}`;
  const makeModel = [vehicle.vehicleMake, vehicle.vehicleModel].filter(Boolean).join(' ');

  return (
    <>
      <span className="flex items-baseline gap-2">
        <span className="font-medium text-ink">{vehicle.registration}</span>
        {makeModel ? <span className="truncate text-xs text-muted">{makeModel}</span> : null}
      </span>
      <span className="mt-0.5 block truncate text-sm text-muted">{vehicle.customerName}</span>
      {/* The three facts worth carrying in a one-line summary: how well known
          this car is, when it was last here, and what it has been worth. The
          full job-by-job breakdown appears once a vehicle is chosen. */}
      <span className="mt-0.5 block text-xs text-muted tabular">
        {visits} · last in {formatDate(vehicle.lastVisit)}
        {vehicle.totalBilledCents > 0
          ? ` · ${formatEur(vehicle.totalBilledCents)} billed`
          : ''}
      </span>
    </>
  );
}

export function RegistrationField({
  value,
  onChange,
  onSelect,
  /** Editing an existing job never searches: see the comment on the effect. */
  enabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (vehicle: VehicleMatch) => void;
  enabled: boolean;
}) {
  const listId = useId();
  /**
   * Results are stored with the term they answered, so what is rendered is
   * derived rather than reset. The previous car's matches stay on screen while
   * the next search is in flight, which is what stops the list blinking empty
   * on every keystroke.
   */
  const [result, setResult] = useState<{ term: string; matches: VehicleMatch[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const matches = result?.matches ?? [];

  const wrapRef = useRef<HTMLDivElement>(null);

  /**
   * Every search result carries the query it came from, and a result is dropped
   * unless it is still the current one.
   *
   * Server Action responses are not guaranteed to arrive in the order they were
   * sent, so a slow `98` landing after a fast `98D1` would otherwise repopulate
   * the list with matches for text the owner has already typed past — on a
   * phone, on the workshop's connection, that is the normal case rather than a
   * rare race.
   */
  const latestQuery = useRef('');

  useEffect(() => {
    /*
      Only when creating. On an existing job the registration is already known
      and the owner is editing it precisely because they know what it should
      say, so offering to overwrite the customer from another job would be a
      destructive suggestion rather than a helpful one.
    */
    if (!enabled) return;

    const term = value.trim();
    latestQuery.current = term;

    // Nothing to ask yet. Deliberately no state written here: this effect body
    // stays free of synchronous setState, and everything the short term should
    // hide is already derived from `value` at render.
    if (term.length < MIN_CHARS) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchVehicleRegistrations(term);
        if (latestQuery.current !== term) return;
        setResult({ term, matches: found });
        setHighlight(-1);
      } catch {
        // A lookup that fails costs the owner a convenience, not the job — the
        // field is still a plain text box and the form still submits.
        if (latestQuery.current === term) setResult({ term, matches: [] });
      } finally {
        if (latestQuery.current === term) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, enabled]);

  // Close on an outside tap. Pointerdown rather than click so the list is gone
  // before a tap on something behind it registers.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const longEnough = value.trim().length >= MIN_CHARS;
  const visible = open && enabled && longEnough;
  const showList = visible && matches.length > 0;
  // Gated on the term still being long enough: deleting back to one character
  // schedules no search, so an in-flight spinner would otherwise never clear.
  const busy = searching && longEnough;

  function choose(vehicle: VehicleMatch) {
    // The stored spelling wins over what was typed: it is the form the owner
    // uses for this car and the form that prints on the invoice, so picking
    // `98-D-12345` from the list must not leave `98d12` in the box.
    onChange(vehicle.registration);
    onSelect(vehicle);
    setOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => {
        const next = current + step;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }

    // Enter only commits a highlighted row. With nothing highlighted it must
    // stay a plain form submit, or a new car could never be booked in by
    // typing its plate and pressing go.
    if (event.key === 'Enter' && highlight >= 0) {
      const picked = matches[highlight];
      if (picked) {
        event.preventDefault();
        choose(picked);
      }
      return;
    }

    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <Field label="Vehicle registration" htmlFor="vehicleRegistration" required>
        <div className="relative">
          <Input
            id="vehicleRegistration"
            name="vehicleRegistration"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="09MN6738"
            required
            role="combobox"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              highlight >= 0 && matches[highlight]
                ? `${listId}-${matches[highlight].normalizedRegistration}`
                : undefined
            }
            className={enabled ? 'pr-9' : undefined}
          />
          {enabled ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
              {busy ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Search aria-hidden className="size-4" />
              )}
            </span>
          ) : null}
        </div>
      </Field>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Vehicles seen before"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          {matches.map((vehicle, index) => (
            <li key={vehicle.normalizedRegistration}>
              <button
                id={`${listId}-${vehicle.normalizedRegistration}`}
                type="button"
                role="option"
                aria-selected={index === highlight}
                /* Pointerdown, not click: on a phone the input blurs first and
                   a click handler would fire after the list had already been
                   dismissed, so the tap would do nothing. */
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(vehicle);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  'flex w-full flex-col px-3 py-2.5 text-left',
                  index === highlight ? 'bg-info-soft' : 'hover:bg-canvas',
                )}
              >
                <VehicleSummary vehicle={vehicle} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {visible && !showList && !busy && result?.term === value.trim() ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Car aria-hidden className="size-3.5" />
          No match — this will be booked in as a new vehicle.
        </p>
      ) : null}
    </div>
  );
}
