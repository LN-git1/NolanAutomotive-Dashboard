/**
 * Toast queue logic, kept pure so it can be unit-tested without React.
 *
 * The provider (`components/providers/toast-provider.tsx`) owns the timers and
 * rendering; this module owns the shape of the queue: newest first, a hard cap
 * on how many are visible at once, and the per-kind time-to-live.
 */

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastInput {
  kind: ToastKind;
  title: string;
  /** Optional second line — a supplier name, an amount, a next step. */
  message?: string;
}

export interface Toast extends ToastInput {
  id: number;
}

/** Enough to show a burst of confirmations without covering the page. */
export const MAX_TOASTS = 4;

/**
 * Errors and warnings last longer than confirmations: a success message is
 * glanceable, an error is something to read (and possibly act on) before it
 * disappears.
 */
const TTL_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 9000,
};

export function toastTtl(kind: ToastKind): number {
  return TTL_MS[kind];
}

/**
 * Add a toast, newest first. Over the cap, the oldest visible toast is dropped
 * so the queue can never grow unboundedly during a burst (e.g. a multi-file
 * upload reporting one message per file).
 */
export function pushToast(
  current: Toast[],
  input: ToastInput,
  id: number,
): { list: Toast[]; dropped: Toast | null } {
  const list = [{ ...input, id }, ...current];

  if (list.length <= MAX_TOASTS) return { list, dropped: null };

  const dropped = list[list.length - 1] ?? null;
  return { list: list.slice(0, MAX_TOASTS), dropped };
}

export function removeToast(current: Toast[], id: number): Toast[] {
  return current.filter((toast) => toast.id !== id);
}
