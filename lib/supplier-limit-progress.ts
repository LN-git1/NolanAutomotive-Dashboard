import { supplierLevel } from '@/lib/push/supplier-level';

/**
 * How full a supplier's bill is against its rough limit, for the progress bar.
 *
 * Pure maths so it can be tested and used from server and client components.
 * The colour bands are the SAME lines the phone alerts use (80% and 100%, from
 * `supplierLevel`), so a bar turning orange and the "balance at 80%" alert
 * always happen together.
 *
 * A limit is a rough guide, not a cap: nothing blocks a purchase, and the bill
 * can go past 100%. `percent` is therefore NOT clamped at the top (an account
 * at 112% says 112%); only the drawn bar stops at full width (`fillPercent`).
 */
export type LimitTone = 'ok' | 'warn' | 'over';

export type LimitProgress = {
  /** Whole percent of the limit used. Zero for a credit. May exceed 100. */
  percent: number;
  /** 0 to 100, for the width of the drawn bar. */
  fillPercent: number;
  tone: LimitTone;
  /** How far past the limit the bill is, in cents; zero when it is not. */
  overByCents: number;
};

/** `null` when there is no usable limit (none set, or zero or less). */
export function limitProgress(balanceCents: number, limitCents: number | null): LimitProgress | null {
  if (limitCents === null || !(limitCents > 0)) return null;

  const used = Math.max(0, balanceCents);
  const percent = Math.round((used / limitCents) * 100);
  const level = supplierLevel(balanceCents, limitCents);

  return {
    percent,
    fillPercent: Math.min(100, percent),
    tone: level === 'full' ? 'over' : level === 'warn' ? 'warn' : 'ok',
    overByCents: Math.max(0, used - limitCents),
  };
}
