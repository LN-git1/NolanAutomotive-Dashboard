import { z } from 'zod';

import { decimalString, optionalEmail, optionalText } from './common';

export const settingsInputSchema = z
  .object({
    businessName: optionalText,
    businessAddress: optionalText,
    businessPhone: optionalText,
    businessEmail: optionalEmail,

    vatRegistered: z
      .union([z.boolean(), z.string()])
      .default(false)
      .transform((value) =>
        typeof value === 'boolean' ? value : value === 'on' || value === 'true',
      ),
    vatNumber: optionalText,
    defaultVatRate: decimalString({ label: 'Default VAT rate' }).default('23'),
    defaultHourlyRate: decimalString({ label: 'Default hourly rate', allowEmpty: true }),
  })
  .refine(
    (value) => !value.vatRegistered || (value.vatNumber !== null && value.vatNumber !== ''),
    {
      message: 'A VAT number is required when the business is VAT registered',
      path: ['vatNumber'],
    },
  );

export type SettingsInput = z.infer<typeof settingsInputSchema>;
