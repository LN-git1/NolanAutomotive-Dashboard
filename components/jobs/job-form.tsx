'use client';

import { ChevronRight, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { LABOUR_COLUMNS, LineEditor, PARTS_COLUMNS } from '@/components/jobs/line-editor';
import { VehicleFields } from '@/components/jobs/vehicle-fields';
import { createJob, lookupJobByRegistration, updateJob } from '@/lib/actions/jobs';
import { formatEur, formatHours, sumLabourHours, toCents } from '@/lib/money';
import { JOB_PRIORITIES, JOB_STATUSES } from '@/lib/validation/job';
import type { Job } from '@/lib/db/schema';

type Prefill = Awaited<ReturnType<typeof lookupJobByRegistration>>;

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

  const [labourRows, setLabourRows] = useState<Record<string, string>[]>(
    () => (job?.labourLines ?? []).map((line) => ({ ...line })),
  );
  const [hourlyRate, setHourlyRate] = useState(job?.hourlyRate ?? defaultHourlyRate);
  const [labourOverride, setLabourOverride] = useState(job?.labourTotalOverride ?? '');
  const [partRows, setPartRows] = useState<Record<string, string>[]>(
    () => (job?.parts ?? []).map((part) => ({ ...part })),
  );

  const totalHoursCentis = useMemo(
    () => sumLabourHours(labourRows.map((row) => ({ description: '', hours: row.hours ?? '' }))),
    [labourRows],
  );

  const overrideActive = labourOverride.trim() !== '';
  // hundredth-hours x cents-per-hour / 100 = cents. Mirrors calcInvoiceTotals.
  const labourCents = overrideActive
    ? toCents(labourOverride)
    : Math.round((totalHoursCentis * toCents(hourlyRate)) / 100);

  const partsCents = useMemo(
    () =>
      partRows.reduce(
        (sum, row) => sum + Math.round((toCents(row.qty || '0') * toCents(row.unitPrice || '0')) / 100),
        0,
      ),
    [partRows],
  );

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

      router.push(result.jobId ? `/jobs/${result.jobId}` : '/jobs');
      router.refresh();
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

      <div key={prefillApplied} className="flex flex-col gap-3">
        <Section title="Customer" defaultOpen>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <Section
          title="Vehicle"
          description="Make and model print on separate lines of the invoice"
          defaultOpen={isNew}
        >
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
                defaultValue={applied?.vehicleVin ?? job?.vehicleVin ?? ''}
              />
            </Field>
          </div>
        </Section>
      </div>

      <Section
        title="Work and labour"
        description="Prints on the invoice — each line shows its hours"
        defaultOpen={!isNew}
        badge={labourRows.length > 0 ? `${labourRows.length}` : undefined}
      >
        <div className="flex flex-col gap-4">
          <LineEditor
            name="labourLines"
            columns={LABOUR_COLUMNS}
            initial={labourRows}
            capacity={labourCapacity}
            addLabel="Add work line"
            emptyLabel="No work lines yet."
            onChange={setLabourRows}
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
        defaultOpen={!isNew && partRows.length > 0}
        badge={partRows.length > 0 ? `${partRows.length}` : undefined}
      >
        <div className="flex flex-col gap-3">
          <LineEditor
            name="parts"
            columns={PARTS_COLUMNS}
            initial={partRows}
            capacity={partsCapacity}
            addLabel="Add part"
            emptyLabel="No parts added."
            rowDefaults={{ qty: '1' }}
            onChange={setPartRows}
          />
          <p className="text-sm text-muted">
            Parts total: <span className="font-semibold text-ink tabular">{formatEur(partsCents)}</span>
          </p>
        </div>
      </Section>

      <Section title="Scheduling and notes">
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
            <Select id="priority" name="priority" defaultValue={job?.priority ?? 'medium'}>
              {JOB_PRIORITIES.map((priority) => (
                <option key={priority} value={priority} className="capitalize">
                  {priority}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due date" htmlFor="dueDate">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={job?.dueDate ?? ''} />
          </Field>

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
