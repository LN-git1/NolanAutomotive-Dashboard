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

/**
 * Decimal string for a money/quantity field, kept as a string end-to-end.
 *
 * `maxIntegerDigits` guards against a value that would overflow its Postgres
 * `numeric` column — without it, a value like `999999999999.99` passes this
 * check and validation, then throws an unhandled overflow error out of the
 * server action instead of a clean, user-facing rejection.
 */
export const decimalString = (options: {
  label: string;
  allowEmpty?: boolean;
  maxIntegerDigits?: number;
}) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value ?? '').trim())
    .refine(
      (value) => (options.allowEmpty && value === '') || /^\d+(\.\d{1,4})?$/.test(value),
      `${options.label} must be a positive number`,
    )
    .refine((value) => {
      if (options.maxIntegerDigits === undefined) return true;
      if (options.allowEmpty && value === '') return true;
      const [intPart = ''] = value.split('.');
      return intPart.length <= options.maxIntegerDigits;
    }, `${options.label} is too large`);

/**
 * Same decimal, but the field may be absent from the payload entirely — an
 * unchecked box, a collapsed form section, a row whose key was never set.
 * `decimalString` rejects `undefined`, which is right for a field that must be
 * present and wrong for one that need not be.
 */
export const optionalDecimalString = (options: { label: string }) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined || value === null ? '' : String(value).trim()))
    .refine(
      (value) => value === '' || /^\d+(\.\d{1,4})?$/.test(value),
      `${options.label} must be a positive number`,
    );

/**
 * ...and null for a nullable column, where "unset" and 0 mean different things
 * to the person reading the form.
 */
export const optionalDecimal = (options: { label: string }) =>
  optionalDecimalString(options).transform((value) => (value === '' ? null : value));

/**
 * Rows from a repeating-row editor.
 *
 * FormData has no encoding for an array of objects, so the editors post their
 * rows as a single JSON string in a hidden input. This parses that string and
 * then validates it with the real item schema, so the server action stays the
 * only validator — the client is never trusted to have produced sane rows.
 */
export const jsonArray = <T extends z.ZodTypeAny>(
  item: T,
  options: { label: string; max: number },
) =>
  z
    .string()
    .optional()
    .transform((value, ctx): unknown[] => {
      if (!value || value.trim() === '') return [];
      try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        return parsed;
      } catch {
        ctx.addIssue({ code: 'custom', message: `${options.label} could not be read` });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(item)
        .max(options.max, `${options.label}: at most ${options.max} lines`),
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
