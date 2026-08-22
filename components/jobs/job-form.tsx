'use client';

import { ChevronRight, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { LABOUR_COLUMNS, LineEditor, PARTS_COLUMNS } from '@/components/jobs/line-editor';
import { VehicleFields } from '@/components/jobs/vehicle-fields';
import { createJob, lookupJobByRegistration, updateJob } from '@/lib/actions/jobs';
import { applyQuantity, formatEur, formatHours, sumLabourHours, toCents } from '@/lib/money';
import { JOB_PRIORITIES, JOB_STATUSES } from '@/lib/validation/job';
import type { Job } from '@/lib/db/schema';
import type { ImportPrefill } from '@/lib/import/map';

type Prefill = Awaited<ReturnType<typeof lookupJobByRegistration>>;

/**
 * Key a stashed import-parse result is written under (by
 * `components/jobs/new-job-modal.tsx`) so this form can pick it up on mount.
 * Exported so the writer imports the same constant rather than duplicating
 * the string.
 */
export const IMPORT_PREFILL_KEY = 'nolan:job-import-prefill';

/**
 * Sections fold, because this form now carries everything that ends up on an
 * invoice and roughly 90% of use is on a phone. Registration and customer are
 * open by default — the rest is a tap away rather than a screen of scrolling.
 *
 * `<details>` is used rather than hand-rolled state so it works before hydration
 * and gets keyboard and screen-reader behaviour for free.
 */
function Section({
  title,
  description,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  return (
    <Card>
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{title}</span>
            {description ? <span className="block text-xs text-muted">{description}</span> : null}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-brand-dark">
              {badge}
            </span>
          ) : null}
        </summary>
        <div className="border-t border-line px-4 py-4">{children}</div>
      </details>
    </Card>
  );
}

export function JobForm({
  job,
  defaultHourlyRate = '',
  labourCapacity,
  partsCapacity,
}: {
  job?: Job;
  /** The owner's usual rate, so a new job starts pre-filled rather than blank. */
  defaultHourlyRate?: string;
  /**
   * How many rows the invoice template can print. Passed in from the server
   * because it is read from the PDF coordinates, and `lib/pdf/stamp` is
   * server-only. Re-working the template therefore changes these limits on its
   * own — nothing here hard-codes a number.
   */
  labourCapacity: number;
  partsCapacity: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isNew = !job;

  const [registration, setRegistration] = useState(job?.vehicleRegistration ?? '');
  const [prefill, setPrefill] = useState<Prefill>(null);
  const [prefillApplied, setPrefillApplied] = useState(0);
  const [lookingUp, setLookingUp] = useState(false);

  const [imported, setImported] = useState<ImportPrefill | null>(null);

  /**
   * Must be a `useEffect`, not a lazy `useState` initializer. This component is
   * rendered from a Server Component and hydrated — a lazy initializer runs
   * during SSR too, where `sessionStorage` doesn't exist, so the server would
   * render "nothing imported" while the client's first hydration pass rendered
   * the real payload: a hydration mismatch on every prefilled `defaultValue`.
   * An effect runs strictly after hydration, so SSR and the first client
   * render agree, and the remount below (which reads `imported`) happens
   * cleanly afterward with no mismatch.
   *
   * Consumes and clears immediately — a stale entry from an earlier abandoned
   * import must never leak into a later, unrelated blank-form visit.
   *
   * Guarded to `isNew`: an import prefill only ever makes sense on a fresh
   * job. Without this guard, a stale sessionStorage entry (from an import the
   * owner started but never finished landing on `/jobs/new`) would silently
   * consume itself and pollute an unrelated EXISTING job's fields the next
   * time any `JobForm` happened to mount in the same tab — an edit page is
   * exactly the "unrelated visit" the doc comment above is warning about, not
   * just a blank one. Returning early here also leaves the entry untouched in
   * storage, so a genuinely pending import is still there for whenever the
   * owner does land on `/jobs/new`.
   */
  useEffect(() => {
    if (!isNew) return;
    const raw = sessionStorage.getItem(IMPORT_PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(IMPORT_PREFILL_KEY);
    try {
      const parsedImport = JSON.parse(raw) as ImportPrefill;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external system (sessionStorage) that doesn't exist during SSR, not a derivable-from-props value; this IS the sanctioned use of an effect, see the doc comment above.
      setImported(parsedImport);
      if (registration.trim() === '' && parsedImport.vehicleRegistration) {
        setRegistration(parsedImport.vehicleRegistration);
      }
    } catch {
      // A corrupted entry is a missing convenience, not an error worth showing.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount, deliberately not re-running on `registration`/`isNew` changes
  }, []);

  /**
   * The row data itself lives entirely inside each `LineEditor` — this form
   * never holds a mirrored copy. Only the two numbers below (count, total)
   * come back up, via `onTotalsChange`. That is what keeps typing a work
   * description or a part name from re-rendering the rest of this form: the
   * total is unchanged, so `setLabourSummary`/`setPartsSummary` receive an
   * `Object.is`-equal value and React bails out rather than re-rendering.
   *
   * Initial values are computed directly from `job` — the same arithmetic
   * `LineEditor` will report back once mounted — so there is no flash from an
   * empty summary before the first render.
   */
  const [labourSummary, setLabourSummary] = useState(() => ({
    count: job?.labourLines?.length ?? 0,
    total: sumLabourHours(
      (job?.labourLines ?? []).map((line) => ({ description: '', hours: line.hours ?? '' })),
    ),
  }));
  const [hourlyRate, setHourlyRate] = useState(job?.hourlyRate ?? defaultHourlyRate);
  const [labourOverride, setLabourOverride] = useState(job?.labourTotalOverride ?? '');
  const [partsSummary, setPartsSummary] = useState(() => ({
    count: job?.parts?.length ?? 0,
    total: (job?.parts ?? []).reduce((sum, part) => sum + applyQuantity(part.qty, part.unitPrice), 0),
  }));

  /**
   * `labourSummary`/`partsSummary` above are otherwise only ever computed
   * once at mount, from `job` — nothing else recomputes them when a
   * `LineEditor` remounts with new `initial` rows, since `onTotalsChange`
   * only fires from a user editing a row by hand. Without this, an import
   * that lands with real hours/parts would show "0 lines / €0.00" until the
   * owner touched a row themselves.
   */
  useEffect(() => {
    if (!imported) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberately re-deriving these two summaries from `imported`, the same external-payload sync as the effect above; see that effect's doc comment.
    setLabourSummary({
      count: imported.labourLines.length,
      total: sumLabourHours(imported.labourLines.map((l) => ({ description: '', hours: l.hours ?? '' }))),
    });
    setPartsSummary({
      count: imported.parts.length,
      total: imported.parts.reduce((sum, p) => sum + applyQuantity(p.qty, p.unitPrice), 0),
    });
  }, [imported]);

  const totalHoursCentis = labourSummary.total;

  const overrideActive = labourOverride.trim() !== '';
  // hundredth-hours x cents-per-hour / 100 = cents. Mirrors calcInvoiceTotals.
  const labourCents = overrideActive
    ? toCents(labourOverride)
    : Math.round((totalHoursCentis * toCents(hourlyRate)) / 100);

  // applyQuantity, not a hand-rolled qty*price: it preserves qty to 4 decimal
  // places, matching the authoritative path (calcInvoiceTotals / the stamped
  // PDF) exactly, so this live total can never disagree with the real one.
  const partsCents = partsSummary.total;

  /**
   * Look up the registration when the field loses focus. Only on a new job:
   * silently rewriting an existing job's customer would be destructive, and the
   * owner is editing it precisely because they know what it should say.
   */
  async function handleRegistrationBlur() {
    if (!isNew || registration.trim() === '') return;

    setLookingUp(true);
    try {
      const found = await lookupJobByRegistration(registration);
      setPrefill(found);
    } catch {
      // A failed lookup is a missing convenience, not an error worth showing.
      setPrefill(null);
    } finally {
      setLookingUp(false);
    }
  }

  function applyPrefill() {
    // Bumping the key remounts the customer and vehicle fields so their
    // defaultValues are picked up, without turning every input into controlled state.
    setPrefillApplied((n) => n + 1);
  }

  const applied = prefillApplied > 0 ? prefill : null;

  /**
   * Drives the Customer+Vehicle remount, since both `applied` (the
   * registration-lookup "Use these details" button) and `imported` can
   * supply those fields. `imported` flips exactly once (null -> object, on
   * mount) and then stays stable, so this only changes twice in a session at
   * most: once if/when an import lands, and again each time the
   * registration-lookup button is tapped.
   */
  const formVersion = `${prefillApplied}:${imported ? 1 : 0}`;

  /**
   * Work/labour, Parts, and Scheduling/notes are driven only by `imported`
   * — never `applied`. A returning customer's PREVIOUS job's labour lines,
   * due date, or notes have no business appearing on a new one, so `Prefill`
   * (the registration-lookup type) is never read for these. Keying these
   * sections on `formVersion` instead would remount them every time "Use
   * these details" is tapped too, silently discarding any labour/parts rows
   * or notes the owner had already typed by hand — exactly what Task 10's
   * manual verification checklist confirms must NOT happen.
   */
  const importVersion = imported ? 1 : 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = job ? await updateJob(job.id, formData) : await createJob(formData);

      if (!result.ok) {
        setError(result.error ?? 'Could not save the job.');
        return;
      }

      if (job) {
        // Editing: already at this exact URL. Pushing it again added a
        // duplicate history entry, so leaving the page needed Back twice.
        router.refresh();
      } else {
        router.push(result.jobId ? `/jobs/${result.jobId}` : '/jobs');
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error ? <Alert>{error}</Alert> : null}

      {/* Registration leads: it is the one thing the owner always knows when a
          car arrives, and it is what identifies a returning customer. */}
      <Card>
        <CardHeader title="Registration" description="Start here — a car you've seen before fills itself in" />
        <CardBody className="flex flex-col gap-3">
          <Field label="Vehicle registration" htmlFor="vehicleRegistration" required>
            <Input
              id="vehicleRegistration"
              name="vehicleRegistration"
              value={registration}
              onChange={(event) => setRegistration(event.target.value)}
              onBlur={handleRegistrationBlur}
              autoCapitalize="characters"
              placeholder="09MN6738"
              required
            />
          </Field>

          {lookingUp ? <p className="text-xs text-muted">Checking previous jobs…</p> : null}

          {isNew && prefill && prefillApplied === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-info-soft px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-ink">Seen before — {prefill.jobNumber}</p>
                <p className="truncate text-muted">
                  {prefill.customerName}
                  {prefill.vehicleMake || prefill.vehicleModel
                    ? ` · ${[prefill.vehicleMake, prefill.vehicleModel].filter(Boolean).join(' ')}`
                    : ''}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={applyPrefill}>
                <Wand2 aria-hidden className="size-4" />
                Use these details
              </Button>
            </div>
          ) : null}

          {prefillApplied > 0 ? (
            <p className="text-xs text-muted">
              Filled in from {prefill?.jobNumber}. Edit anything that has changed.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div key={formVersion} className="flex flex-col gap-3">
        <Section title="Customer" defaultOpen>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* No autoComplete="name"/"tel"/"email" below — this is the
                customer's info, not the owner's; profile autofill would offer
                the owner's own name/number/email instead. */}
            <Field label="Name" htmlFor="customerName" required className="sm:col-span-2">
              <Input
                id="customerName"
                name="customerName"
                defaultValue={applied?.customerName ?? imported?.customerName ?? job?.customerName ?? ''}
                required
              />
            </Field>

            <Field label="Phone" htmlFor="customerPhone">
              <Input
                id="customerPhone"
                name="customerPhone"
                type="tel"
                defaultValue={applied?.customerPhone ?? imported?.customerPhone ?? job?.customerPhone ?? ''}
              />
            </Field>

            <Field label="Email" htmlFor="customerEmail">
              <Input
                id="customerEmail"
                name="customerEmail"
                type="email"
                defaultValue={applied?.customerEmail ?? imported?.customerEmail ?? job?.customerEmail ?? ''}
              />
            </Field>

            <Field label="Address" htmlFor="customerAddress" className="sm:col-span-2">
              <Textarea
                id="customerAddress"
                name="customerAddress"
                rows={3}
                defaultValue={applied?.customerAddress ?? imported?.customerAddress ?? job?.customerAddress ?? ''}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Vehicle"
          description="Make and model print on separate lines of the invoice"
          defaultOpen={isNew}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <VehicleFields
              defaultYear={applied?.vehicleYear ?? imported?.vehicleYear ?? job?.vehicleYear}
              defaultMake={applied?.vehicleMake ?? imported?.vehicleMake ?? job?.vehicleMake}
              defaultModel={applied?.vehicleModel ?? imported?.vehicleModel ?? job?.vehicleModel}
            />

            <Field label="Colour" htmlFor="vehicleColor">
              <Input
                id="vehicleColor"
                name="vehicleColor"
                defaultValue={applied?.vehicleColor ?? imported?.vehicleColor ?? job?.vehicleColor ?? ''}
              />
            </Field>

            <Field label="Mileage" htmlFor="vehicleMileage">
              <Input
                id="vehicleMileage"
                name="vehicleMileage"
                inputMode="numeric"
                defaultValue={applied?.vehicleMileage ?? imported?.vehicleMileage ?? job?.vehicleMileage ?? ''}
              />
            </Field>

            <Field label="VIN" htmlFor="vehicleVin" className="sm:col-span-2">
              <Input
                id="vehicleVin"
                name="vehicleVin"
                autoCapitalize="characters"
                defaultValue={applied?.vehicleVin ?? imported?.vehicleVin ?? job?.vehicleVin ?? ''}
              />
            </Field>
          </div>
        </Section>
      </div>

      <Section
        title="Work and labour"
        description="Prints on the invoice — each line shows its hours"
        defaultOpen={!isNew || (imported?.labourLines?.length ?? 0) > 0}
        badge={labourSummary.count > 0 ? `${labourSummary.count}` : undefined}
      >
        <div className="flex flex-col gap-4">
          <LineEditor
            key={importVersion}
            name="labourLines"
            columns={LABOUR_COLUMNS}
            initial={
              imported && imported.labourLines.length > 0
                ? imported.labourLines.map((l): Record<string, string> => ({ description: l.description, hours: l.hours }))
                : (job?.labourLines ?? []).map((l): Record<string, string> => ({ description: l.description, hours: l.hours }))
            }
            capacity={labourCapacity}
            addLabel="Add work line"
            emptyLabel="No work lines yet."
            computeTotal={(rows) =>
              sumLabourHours(rows.map((row) => ({ description: '', hours: row.hours ?? '' })))
            }
            onTotalsChange={setLabourSummary}
          />

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
            <Field label="Total hours" htmlFor="totalHours" hint="Added up from the lines above">
              <Input id="totalHours" value={formatHours(totalHoursCentis)} readOnly disabled />
            </Field>

            <Field label="Hourly rate (€)" htmlFor="hourlyRate">
              <Input
                id="hourlyRate"
                name="hourlyRate"
                inputMode="decimal"
                value={hourlyRate}
                disabled={overrideActive}
                onChange={(event) => setHourlyRate(event.target.value)}
                placeholder="0.00"
              />
            </Field>

            <Field
              label="Custom total (€)"
              htmlFor="labourTotalOverride"
              hint="Overrides hours × rate when filled. The hours still print on the invoice."
              className="col-span-2"
            >
              <Input
                id="labourTotalOverride"
                name="labourTotalOverride"
                inputMode="decimal"
                value={labourOverride}
                onChange={(event) => setLabourOverride(event.target.value)}
                placeholder="Leave blank to use hours × rate"
              />
            </Field>
          </div>

          <p className="text-sm text-muted">
            Labour total:{' '}
            <span className="font-semibold text-ink tabular">{formatEur(labourCents)}</span>
            {overrideActive ? ' (custom)' : null}
          </p>
        </div>
      </Section>

      <Section
        title="Parts"
        defaultOpen={!isNew && partsSummary.count > 0}
        badge={partsSummary.count > 0 ? `${partsSummary.count}` : undefined}
      >
        <div className="flex flex-col gap-3">
          <LineEditor
            key={importVersion}
            name="parts"
            columns={PARTS_COLUMNS}
            initial={
              imported && imported.parts.length > 0
                ? imported.parts.map((p): Record<string, string> => ({
                    partName: p.partName,
                    partNumber: p.partNumber,
                    qty: p.qty,
                    unitPrice: p.unitPrice,
                  }))
                : (job?.parts ?? []).map((p): Record<string, string> => ({
                    partName: p.partName,
                    partNumber: p.partNumber,
                    qty: p.qty,
                    unitPrice: p.unitPrice,
                  }))
            }
            capacity={partsCapacity}
            addLabel="Add part"
            emptyLabel="No parts added."
            rowDefaults={{ qty: '1' }}
            computeTotal={(rows) =>
              rows.reduce((sum, row) => sum + applyQuantity(row.qty, row.unitPrice), 0)
            }
            onTotalsChange={setPartsSummary}
          />
          <p className="text-sm text-muted">
            Parts total: <span className="font-semibold text-ink tabular">{formatEur(partsCents)}</span>
          </p>
        </div>
      </Section>

      {/*
        `key={importVersion}` remounts this section's fields the one time an
        import lands, the same reason the LineEditors above are keyed on it:
        `defaultValue` is only read at mount, so without a remount the
        `imported?.X` values added below to `dueDate`/`dueTime`/`priority`/
        `otherComments`/`notes` would never actually reach the screen even
        though the value is technically in the `??` chain. `defaultOpen`
        needs no such trick — `open` is a plain DOM attribute Section
        re-applies every render.
      */}
      <Section
        key={importVersion}
        title="Scheduling and notes"
        defaultOpen={Boolean(imported?.dueDate || imported?.dueTime || imported?.otherComments || imported?.notes)}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={job?.status ?? 'active'}>
              {JOB_STATUSES.map((status) => (
                <option key={status} value={status} className="capitalize">
                  {status}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={imported?.priority ?? job?.priority ?? 'medium'}>
              {JOB_PRIORITIES.map((priority) => (
                <option key={priority} value={priority} className="capitalize">
                  {priority}
                </option>
              ))}
            </Select>
          </Field>

          {/* Date and time share one grid slot, split evenly, rather than each
              taking a full column — they're one decision ("when"), not two. */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" htmlFor="dueDate">
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={imported?.dueDate ?? job?.dueDate ?? ''}
              />
            </Field>

            <Field label="Due time" htmlFor="dueTime">
              <Input
                id="dueTime"
                name="dueTime"
                type="time"
                defaultValue={imported?.dueTime ?? job?.dueTime ?? ''}
              />
            </Field>
          </div>

          <Field
            label="Other comments"
            htmlFor="otherComments"
            hint="PRINTS on the invoice, in the Other Comments box."
            className="sm:col-span-3"
          >
            <Textarea
              id="otherComments"
              name="otherComments"
              rows={3}
              defaultValue={imported?.otherComments ?? job?.otherComments ?? ''}
            />
          </Field>

          <Field
            label="Notes"
            htmlFor="notes"
            hint="Private. NEVER printed on an invoice."
            className="sm:col-span-3"
          >
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={imported?.notes ?? job?.notes ?? ''}
            />
          </Field>
        </div>
      </Section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : job ? 'Save changes' : 'Create job'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
