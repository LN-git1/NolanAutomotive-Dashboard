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

/** "HH:MM" (24-hour, as stored/submitted) -> "4:30pm". */
export function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute}${period}`;
}

/** A numeric column returned by Drizzle as a string -> display euros. */
export function numericToEur(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '€0.00';
  const [whole = '0', frac = '00'] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `€${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}
