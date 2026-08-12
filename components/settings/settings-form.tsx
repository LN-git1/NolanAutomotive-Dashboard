'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { updateSettings } from '@/lib/actions/settings';
import type { Settings } from '@/lib/db/schema';

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [vatRegistered, setVatRegistered] = useState(settings.vatRegistered);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateSettings(formData);
      if (!result.ok) {
        setError(result.error ?? 'Could not save settings.');
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      {saved ? <Alert tone="ok">Settings saved.</Alert> : null}

      <Card>
        <CardHeader
          title="Business details"
          description="Used for message text and exports. The invoice template already carries the letterhead."
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="businessName">
            <Input id="businessName" name="businessName" defaultValue={settings.businessName ?? ''} />
          </Field>

          <Field label="Phone" htmlFor="businessPhone">
            <Input id="businessPhone" name="businessPhone" defaultValue={settings.businessPhone ?? ''} />
          </Field>

          <Field label="Email" htmlFor="businessEmail">
            <Input
              id="businessEmail"
              name="businessEmail"
              type="email"
              defaultValue={settings.businessEmail ?? ''}
            />
          </Field>

          <Field label="Address" htmlFor="businessAddress" className="sm:col-span-2">
            <Textarea
              id="businessAddress"
              name="businessAddress"
              rows={2}
              defaultValue={settings.businessAddress ?? ''}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="VAT"
          description="When switched off, the VAT rate and every tax amount on an invoice are zero."
        />
        <CardBody className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="vatRegistered"
              checked={vatRegistered}
              onChange={(event) => setVatRegistered(event.target.checked)}
              className="size-4"
            />
            Business is VAT registered
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="VAT number"
              htmlFor="vatNumber"
              required={vatRegistered}
              hint="Printed in the Other Comments area — the template has no dedicated VAT field."
            >
              <Input
                id="vatNumber"
                name="vatNumber"
                defaultValue={settings.vatNumber ?? ''}
                disabled={!vatRegistered}
              />
            </Field>

            <Field label="Default VAT rate (%)" htmlFor="defaultVatRate">
              <Input
                id="defaultVatRate"
                name="defaultVatRate"
                inputMode="decimal"
                defaultValue={settings.defaultVatRate}
                disabled={!vatRegistered}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Invoicing defaults" />
        <CardBody>
          <Field
            label="Default hourly labour rate (€)"
            htmlFor="defaultHourlyRate"
            hint="Pre-fills the Invoicer; still editable per invoice."
          >
            <Input
              id="defaultHourlyRate"
              name="defaultHourlyRate"
              inputMode="decimal"
              defaultValue={settings.defaultHourlyRate ?? ''}
            />
          </Field>
        </CardBody>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
