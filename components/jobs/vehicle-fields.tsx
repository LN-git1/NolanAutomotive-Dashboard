'use client';

import { useState } from 'react';

import { Button, Field, Input, Select } from '@/components/ui';
import {
  MAKE_NAMES,
  OTHER_OPTION,
  isKnownMake,
  isKnownModel,
  modelsForMake,
  vehicleYears,
} from '@/lib/vehicles';

/**
 * Year / make / model pickers for the job form.
 *
 * The point is to remove typing on a phone: pick a make and the model list
 * narrows to that make's models. Choosing a model before a make is impossible —
 * the field says so rather than showing an empty list.
 *
 * Every field keeps an "Other…" escape hatch that swaps in a free-text box. A
 * garage will eventually see a vehicle that is not in any list, and a
 * dropdown-only field would block the job outright. The same mechanism means an
 * existing job whose make was typed before these lists existed still edits
 * cleanly instead of silently losing its value.
 */
export function VehicleFields({
  defaultYear,
  defaultMake,
  defaultModel,
}: {
  defaultYear?: number | null;
  defaultMake?: string | null;
  defaultModel?: string | null;
}) {
  const years = vehicleYears();

  // Anything already stored that is not in the lists starts in free-text mode,
  // so editing an old job never quietly discards its make or model.
  const [customMake, setCustomMake] = useState(
    Boolean(defaultMake) && !isKnownMake(defaultMake),
  );
  const [customModel, setCustomModel] = useState(
    Boolean(defaultModel) && !isKnownModel(defaultMake, defaultModel),
  );

  const [make, setMake] = useState(defaultMake ?? '');
  const [model, setModel] = useState(defaultModel ?? '');

  const models = modelsForMake(make);

  function handleMakeChange(value: string) {
    if (value === OTHER_OPTION) {
      setCustomMake(true);
      setMake('');
      setCustomModel(true);
      setModel('');
      return;
    }

    setCustomMake(false);
    setMake(value);
    // The old model almost certainly belongs to a different manufacturer.
    setModel('');
    setCustomModel(false);
  }

  function handleModelChange(value: string) {
    if (value === OTHER_OPTION) {
      setCustomModel(true);
      setModel('');
      return;
    }

    setModel(value);
  }

  return (
    <>
      <Field label="Year" htmlFor="vehicleYear">
        <Select id="vehicleYear" name="vehicleYear" defaultValue={defaultYear ?? ''}>
          <option value="">Select a year</option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Make" htmlFor="vehicleMake">
        {customMake ? (
          <div className="flex gap-2">
            <Input
              id="vehicleMake"
              name="vehicleMake"
              value={make}
              onChange={(event) => setMake(event.target.value)}
              placeholder="Enter the make"
              autoFocus
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setCustomMake(false);
                setMake('');
                setCustomModel(false);
                setModel('');
              }}
            >
              List
            </Button>
          </div>
        ) : (
          <Select
            id="vehicleMake"
            name="vehicleMake"
            value={make}
            onChange={(event) => handleMakeChange(event.target.value)}
          >
            <option value="">Select a make</option>
            {MAKE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={OTHER_OPTION}>Other…</option>
          </Select>
        )}
      </Field>

      <Field
        label="Model"
        htmlFor="vehicleModel"
        hint={!make && !customModel ? 'Choose a make first.' : undefined}
      >
        {customModel ? (
          <div className="flex gap-2">
            <Input
              id="vehicleModel"
              name="vehicleModel"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Enter the model"
            />
            {models.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setCustomModel(false);
                  setModel('');
                }}
              >
                List
              </Button>
            ) : null}
          </div>
        ) : (
          <Select
            id="vehicleModel"
            name="vehicleModel"
            value={model}
            disabled={!make}
            onChange={(event) => handleModelChange(event.target.value)}
          >
            <option value="">{make ? 'Select a model' : 'Select a make first'}</option>
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {make ? <option value={OTHER_OPTION}>Other…</option> : null}
          </Select>
        )}
      </Field>
    </>
  );
}
