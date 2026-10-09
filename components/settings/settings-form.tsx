'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { useTimeFormat } from '@/components/providers/time-format-provider';
import { useToast } from '@/components/providers/toast-provider';
import { updateSettings } from '@/lib/actions/settings';
import type { TimeFormat } from '@/lib/format';
import type { Settings } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const { setTimeFormat: syncGlobalTimeFormat, isPending: timeFormatPending } = useTimeFormat();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [vatRegistered, setVatRegistered] = useState(settings.vatRegistered);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(settings.timeFormat ?? '12h');
  const [pending, startTransition] = useTransition();

  function handleTimeFormatChange(nextFormat: TimeFormat) {
    if (nextFormat === timeFormat || timeFormatPending) return;
    setTimeFormat(nextFormat);
    void syncGlobalTimeFormat(nextFormat).then((result) => {
      if (result.ok) {
        toast.success(
          nextFormat === '24h' ? '24-hour times on' : '12-hour times on',
          'Every time on the dashboard follows this.',
        );
      } else {
        // The provider already flipped the switch back; say why.
        setTimeFormat(nextFormat === '24h' ? '12h' : '24h');
        toast.error('Time format not saved', result.error ?? 'Could not save the time format.');
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateSettings(formData);
      if (!result.ok) {
        const message = result.error ?? 'Could not save settings.';
        setError(message);
        toast.error('Settings not saved', message);
        return;
      }
      setSaved(true);
      toast.success('Settings saved');
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

      <Card>
        <CardHeader
          title="Time format"
          description="Choose whether times appear in 12-hour or 24-hour format across the entire dashboard."
        />
        <CardBody className="flex flex-col gap-3">
          <input type="hidden" name="timeFormat" value={timeFormat} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              id="time-format-12h"
              disabled={timeFormatPending}
              onClick={() => handleTimeFormatChange('12h')}
              className={cn(
                'flex cursor-pointer items-center justify-between rounded-md border p-3.5 text-left transition-colors disabled:cursor-wait disabled:opacity-70',
                timeFormat === '12h'
                  ? 'border-brand bg-info-soft text-brand-dark ring-1 ring-brand'
                  : 'border-line bg-surface text-ink hover:bg-canvas',
              )}
            >
              <div>
                <span className="block text-sm font-semibold">12-hour format</span>
                <span className="block text-xs text-muted">e.g. 9:30am, 4:30pm</span>
              </div>
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-xs font-bold',
                  timeFormat === '12h'
                    ? 'border-brand bg-brand text-white'
                    : 'border-line text-transparent',
                )}
              >
                ✓
              </span>
            </button>

            <button
              type="button"
              id="time-format-24h"
              disabled={timeFormatPending}
              onClick={() => handleTimeFormatChange('24h')}
              className={cn(
                'flex cursor-pointer items-center justify-between rounded-md border p-3.5 text-left transition-colors disabled:cursor-wait disabled:opacity-70',
                timeFormat === '24h'
                  ? 'border-brand bg-info-soft text-brand-dark ring-1 ring-brand'
                  : 'border-line bg-surface text-ink hover:bg-canvas',
              )}
            >
              <div>
                <span className="block text-sm font-semibold">24-hour format</span>
                <span className="block text-xs text-muted">e.g. 09:30, 16:30</span>
              </div>
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-xs font-bold',
                  timeFormat === '24h'
                    ? 'border-brand bg-brand text-white'
                    : 'border-line text-transparent',
                )}
              >
                ✓
              </span>
            </button>
          </div>
          <p className="text-xs text-muted">
            Updates schedule chips and agendas, job lists, and overviews across the dashboard.
          </p>
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
