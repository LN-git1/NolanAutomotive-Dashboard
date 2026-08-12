'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { VehicleFields } from '@/components/jobs/vehicle-fields';
import { createJob, updateJob } from '@/lib/actions/jobs';
import { JOB_PRIORITIES, JOB_STATUSES } from '@/lib/validation/job';
import type { Job } from '@/lib/db/schema';

/**
 * Single form used for both create and edit. Submits a plain FormData to the
 * server action, which is the sole validator — the browser's `required`
 * attributes are a convenience, not the security boundary.
 */
export function JobForm({ job }: { job?: Job }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}

      <Card>
        <CardHeader title="Customer" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="customerName" required className="sm:col-span-2">
            <Input id="customerName" name="customerName" defaultValue={job?.customerName ?? ''} required />
          </Field>

          <Field label="Phone" htmlFor="customerPhone">
            <Input
              id="customerPhone"
              name="customerPhone"
              type="tel"
              defaultValue={job?.customerPhone ?? ''}
            />
          </Field>

          <Field label="Email" htmlFor="customerEmail">
            <Input
              id="customerEmail"
              name="customerEmail"
              type="email"
              defaultValue={job?.customerEmail ?? ''}
            />
          </Field>

          <Field label="Address" htmlFor="customerAddress" className="sm:col-span-2">
            <Textarea
              id="customerAddress"
              name="customerAddress"
              rows={3}
              defaultValue={job?.customerAddress ?? ''}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Vehicle"
          description="Make and model are separate because the invoice template prints them on separate lines."
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Registration" htmlFor="vehicleRegistration" required>
            <Input
              id="vehicleRegistration"
              name="vehicleRegistration"
              defaultValue={job?.vehicleRegistration ?? ''}
              autoCapitalize="characters"
              required
            />
          </Field>

          <VehicleFields
            defaultYear={job?.vehicleYear}
            defaultMake={job?.vehicleMake}
            defaultModel={job?.vehicleModel}
          />

          <Field label="Colour" htmlFor="vehicleColor">
            <Input id="vehicleColor" name="vehicleColor" defaultValue={job?.vehicleColor ?? ''} />
          </Field>

          <Field label="Mileage" htmlFor="vehicleMileage">
            <Input
              id="vehicleMileage"
              name="vehicleMileage"
              inputMode="numeric"
              defaultValue={job?.vehicleMileage ?? ''}
            />
          </Field>

          <Field label="VIN" htmlFor="vehicleVin" className="sm:col-span-2">
            <Input id="vehicleVin" name="vehicleVin" defaultValue={job?.vehicleVin ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Job" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={job?.status ?? 'new'}>
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
            label="Notes"
            htmlFor="notes"
            hint="Shown to you; may be reused as invoice wording."
            className="sm:col-span-3"
          >
            <Textarea id="notes" name="notes" rows={3} defaultValue={job?.notes ?? ''} />
          </Field>

          <Field
            label="Internal notes"
            htmlFor="internalNotes"
            hint="Never printed on an invoice."
            className="sm:col-span-3"
          >
            <Textarea
              id="internalNotes"
              name="internalNotes"
              rows={3}
              defaultValue={job?.internalNotes ?? ''}
            />
          </Field>
        </CardBody>
      </Card>

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
