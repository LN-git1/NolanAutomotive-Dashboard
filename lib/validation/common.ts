import { z } from 'zod';

/**
 * Shared field helpers.
 *
 * HTML forms submit empty strings, not nulls. Every optional column in this app
 * is nullable in Postgres, so these helpers normalise "" -> null once, here,
 * rather than in every action.
 */

export const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== '' ? value : null));

export const requiredText = (label: string, max = 500) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== '' ? value : null))
  .refine(
    (value) => value === null || z.email().safeParse(value).success,
    'Enter a valid email address',
  );

/** Optional whole number from a form field (e.g. year, mileage). */
export const optionalInt = (options: { min?: number; max?: number; label: string }) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = typeof value === 'number' ? value : Number(value.trim());
      return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
    })
    .refine((value) => value === null || !Number.isNaN(value), `${options.label} must be a number`)
    .refine(
      (value) => value === null || options.min === undefined || value >= options.min,
      `${options.label} must be at least ${options.min}`,
    )
    .refine(
      (value) => value === null || options.max === undefined || value <= options.max,
      `${options.label} must be at most ${options.max}`,
    );

/** Decimal string for a money/quantity field, kept as a string end-to-end. */
export const decimalString = (options: { label: string; allowEmpty?: boolean }) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value ?? '').trim())
    .refine(
      (value) => (options.allowEmpty && value === '') || /^\d+(\.\d{1,4})?$/.test(value),
      `${options.label} must be a positive number`,
    );

/** ISO date (yyyy-mm-dd) from a date input, or null. */
export const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== '' ? value : null))
  .refine(
    (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
    'Enter a valid date',
  );

export const requiredDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');

export const uuidString = z.string().uuid('Invalid identifier');
