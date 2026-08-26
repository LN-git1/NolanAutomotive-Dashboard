'use client';

import { ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { LABOUR_COLUMNS, LineEditor, PARTS_COLUMNS } from '@/components/jobs/line-editor';
import { RegistrationField } from '@/components/jobs/registration-field';
import { VehicleFields } from '@/components/jobs/vehicle-fields';
import { VehicleHistory } from '@/components/jobs/vehicle-history';
import { createJob, updateJob } from '@/lib/actions/jobs';
import { applyQuantity, formatEur, formatHours, sumLabourHours, toCents } from '@/lib/money';
import { JOB_PRIORITIES } from '@/lib/validation/job';
import type { VehicleMatch } from '@/lib/db/queries/vehicles';
import type { Job } from '@/lib/db/schema';

/**
 * Sections fold, because this form now carries everything that ends up on an
 * invoice and roughly 90% of use is on a phone. Every section starts
 * collapsed — Registration sits above them as its own always-open card — so
 * opening the form always shows the same short, scannable list of headers
 * rather than however much the previous job happened to have filled in.
 *
 * `<details>` is used rather than hand-rolled state so it works before hydration
 * and gets keyboard and screen-reader behaviour for free.
 */
function Section({
  title,
  description,
  children,
  badge,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  badge?: string;
}) {
  return (
    <Card>
      <details className="group">
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
  const [prefill, setPrefill] = useState<VehicleMatch | null>(null);
  const [prefillApplied, setPrefillApplied] = useState(0);

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
  const [partsOverride, setPartsOverride] = useState(job?.partsTotalOverride ?? '');

  const totalHoursCentis = labourSummary.total;

  const overrideActive = labourOverride.trim() !== '';
  // hundredth-hours x cents-per-hour / 100 = cents. Mirrors calcInvoiceTotals.
  const labourCents = overrideActive
    ? toCents(labourOverride)
    : Math.round((totalHoursCentis * toCents(hourlyRate)) / 100);

  const partsOverrideActive = partsOverride.trim() !== '';
  // applyQuantity, not a hand-rolled qty*price: it preserves qty to 4 decimal
  // places, matching the authoritative path (calcInvoiceTotals / the stamped
  // PDF) exactly, so this live total can never disagree with the real one —
  // unless a flat override is set, which mirrors labour's own override above.
  const partsCents = partsOverrideActive ? toCents(partsOverride) : partsSummary.total;

  /**
   * Picking a vehicle from the suggestions fills the form in immediately, with
   * no second "use these details" tap. Choosing a specific car out of a list of
   * near-identical plates IS the confirmation — asking again would be asking
   * the same question twice, and the details are all editable afterwards
   * anyway.
   */
  function handleVehicleSelected(vehicle: VehicleMatch) {
    setPrefill(vehicle);
    // Bumping the key remounts the customer and vehicle fields so their
    // defaultValues are picked up, without turning every input into controlled state.
    setPrefillApplied((n) => n + 1);
  }

  const applied = prefillApplied > 0 ? prefill : null;

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
        <CardHeader
          title="Registration"
          description="Start here — type any part of a plate to find a car you've seen before"
        />
        <CardBody className="flex flex-col gap-3">
          <RegistrationField
            value={registration}
            onChange={setRegistration}
            onSelect={handleVehicleSelected}
            enabled={isNew}
          />

          {applied ? (
            <>
              <p className="text-xs text-muted">
                Filled in from {applied.lastJobNumber}. Edit anything that has changed.
              </p>
              {/* Keyed on the vehicle: choosing a different car remounts this,
                  so one car's jobs can never be left on screen under another
                  car's plate. */}
              <VehicleHistory key={applied.normalizedRegistration} vehicle={applied} />
            </>
          ) : null}
        </CardBody>
      </Card>

      <div key={prefillApplied} className="flex flex-col gap-3">
        <Section title="Customer">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* No autoComplete="name"/"tel"/"email" below — this is the
                customer's info, not the owner's; profile autofill would offer
                the owner's own name/number/email instead. */}
            <Field label="Name" htmlFor="customerName" required className="sm:col-span-2">
              <Input
                id="customerName"
                name="customerName"
                defaultValue={applied?.customerName ?? job?.customerName ?? ''}
                required
              />
            </Field>

            <Field label="Phone" htmlFor="customerPhone">
              <Input
                id="customerPhone"
                name="customerPhone"
                type="tel"
                defaultValue={applied?.customerPhone ?? job?.customerPhone ?? ''}
              />
            </Field>

            <Field label="Email" htmlFor="customerEmail">
              <Input
                id="customerEmail"
                name="customerEmail"
                type="email"
                defaultValue={applied?.customerEmail ?? job?.customerEmail ?? ''}
              />
            </Field>

            <Field label="Address" htmlFor="customerAddress" className="sm:col-span-2">
              <Textarea
                id="customerAddress"
                name="customerAddress"
                rows={3}
                defaultValue={applied?.customerAddress ?? job?.customerAddress ?? ''}
              />
            </Field>
          </div>
        </Section>

        <Section title="Vehicle" description="Make and model print on separate lines of the invoice">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <VehicleFields
              defaultYear={applied?.vehicleYear ?? job?.vehicleYear}
              defaultMake={applied?.vehicleMake ?? job?.vehicleMake}
              defaultModel={applied?.vehicleModel ?? job?.vehicleModel}
            />

            <Field label="Colour" htmlFor="vehicleColor">
              <Input
                id="vehicleColor"
                name="vehicleColor"
                defaultValue={applied?.vehicleColor ?? job?.vehicleColor ?? ''}
              />
            </Field>

            <Field label="Mileage" htmlFor="vehicleMileage">
              <Input
                id="vehicleMileage"
                name="vehicleMileage"
                inputMode="numeric"
                defaultValue={applied?.vehicleMileage ?? job?.vehicleMileage ?? ''}
              />
            </Field>

            <Field label="VIN" htmlFor="vehicleVin" className="sm:col-span-2">
              <Input
                id="vehicleVin"
                name="vehicleVin"
                autoCapitalize="characters"
                defaultValue={applied?.vehicleVin ?? job?.vehicleVin ?? ''}
              />
            </Field>
          </div>
        </Section>
      </div>

      <Section
        title="Work and labour"
        description="Prints on the invoice — each line shows its hours"
        badge={labourSummary.count > 0 ? `${labourSummary.count}` : undefined}
      >
        <div className="flex flex-col gap-4">
          <LineEditor
            name="labourLines"
            columns={LABOUR_COLUMNS}
            initial={(job?.labourLines ?? []).map(
              (l): Record<string, string> => ({ description: l.description, hours: l.hours }),
            )}
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

      <Section title="Parts" badge={partsSummary.count > 0 ? `${partsSummary.count}` : undefined}>
        <div className="flex flex-col gap-3">
          <LineEditor
            name="parts"
            columns={PARTS_COLUMNS}
            initial={(job?.parts ?? []).map(
              (p): Record<string, string> => ({
                partName: p.partName,
                partNumber: p.partNumber,
                qty: p.qty,
                unitPrice: p.unitPrice,
              }),
            )}
            capacity={partsCapacity}
            addLabel="Add part"
            emptyLabel="No parts added."
            rowDefaults={{ qty: '1' }}
            disabledColumns={partsOverrideActive ? ['unitPrice'] : undefined}
            computeTotal={(rows) =>
              rows.reduce((sum, row) => sum + applyQuantity(row.qty, row.unitPrice), 0)
            }
            onTotalsChange={setPartsSummary}
          />

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
            <Field
              label="Custom total (€)"
              htmlFor="partsTotalOverride"
              hint="Overrides the parts lines when filled. Unit prices are ignored and don't print."
              className="col-span-2"
            >
              <Input
                id="partsTotalOverride"
                name="partsTotalOverride"
                inputMode="decimal"
                value={partsOverride}
                onChange={(event) => setPartsOverride(event.target.value)}
                placeholder="Leave blank to use qty × unit price"
              />
            </Field>
          </div>

          <p className="text-sm text-muted">
            Parts total: <span className="font-semibold text-ink tabular">{formatEur(partsCents)}</span>
            {partsOverrideActive ? ' (custom)' : null}
          </p>
        </div>
      </Section>

      <Section title="Scheduling and notes">
        {/*
          No Status control here. It used to sit in this row, and because it was
          uncontrolled (`defaultValue`) it kept whatever value the page was
          rendered with — so recording a payment flipped the job to `paid` and
          the next save on this form quietly put it back. Status now belongs to
          the actions panel beside this form (`JobActions`), which is a live
          control and routes through `changeJobStatus`; on a new job there is
          nothing to choose, since a job that exists is active.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={job?.priority ?? 'medium'}>
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
              <Input id="dueDate" name="dueDate" type="date" defaultValue={job?.dueDate ?? ''} />
            </Field>

            <Field label="Due time" htmlFor="dueTime">
              <Input id="dueTime" name="dueTime" type="time" defaultValue={job?.dueTime ?? ''} />
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
              defaultValue={job?.otherComments ?? ''}
            />
          </Field>

          <Field
            label="Notes"
            htmlFor="notes"
            hint="Private. NEVER printed on an invoice."
            className="sm:col-span-3"
          >
            <Textarea id="notes" name="notes" rows={3} defaultValue={job?.notes ?? ''} />
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
