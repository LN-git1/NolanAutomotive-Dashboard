/**
 * Display formatting shared by pages and the PDF stamper.
 * Irish conventions throughout: DD/MM/YYYY dates, euro amounts.
 */

/** Accepts a Date or a `yyyy-mm-dd` column value. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';

  // Date-only strings are formatted without constructing a Date, which would
  // apply a UTC->local shift and can move the date by a day.
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

/** Today as `yyyy-mm-dd` in local time, for date inputs and issue dates. */
export function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export type TimeFormat = '12h' | '24h';

/**
 * "HH:MM" (24-hour, as stored/submitted) -> formatted time string.
 * In '12h' mode: "16:30" -> "4:30pm", "09:15" -> "9:15am".
 * In '24h' mode: "16:30" -> "16:30", "09:15" -> "09:15".
 */
export function formatTime(
  value: string | null | undefined,
  format: TimeFormat = '12h',
): string | null {
  if (!value) return null;

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  if (format === '24h') {
    return `${match[1]}:${match[2]}`;
  }

  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute}${period}`;
}

/**
 * Format a Date or date string with time in the chosen format.
 * e.g. "12/08/2026 4:30pm" or "12/08/2026 16:30".
 */
export function formatDateTime(
  value: Date | string | null | undefined,
  format: TimeFormat = '12h',
): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dateStr = `${day}/${month}/${date.getFullYear()}`;

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const timeStr = formatTime(`${hours}:${minutes}`, format);

  return `${dateStr} ${timeStr}`;
}

/**
 * Combines a due date ("yyyy-mm-dd") and optional due time ("HH:MM") into display text.
 * e.g. "12/08/2026 · 4:30pm" or "12/08/2026 · 16:30", or just "12/08/2026" if no time set.
 */
export function formatDueDateTime(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined,
  format: TimeFormat = '12h',
): string {
  if (!dueDate && !dueTime) return '—';
  const datePart = dueDate ? formatDate(dueDate) : null;
  const timePart = dueTime ? formatTime(dueTime, format) : null;

  if (datePart && timePart) return `${datePart} · ${timePart}`;
  if (datePart) return datePart;
  if (timePart) return timePart;
  return '—';
}

/** A numeric column returned by Drizzle as a string -> display euros. */
export function numericToEur(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '€0.00';
  const [whole = '0', frac = '00'] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `€${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}
