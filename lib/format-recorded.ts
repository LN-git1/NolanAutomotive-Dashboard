import { formatTime, type TimeFormat } from '@/lib/format';
import { dublinClock } from '@/lib/push/dublin';

/**
 * "When was this typed into the app", in the same style as every other date and
 * time on screen ("06/11/2026 4:30pm" or "06/11/2026 16:30").
 *
 * Always Europe/Dublin. `formatDateTime` in `lib/format.ts` reads the server's
 * own clock, which on Vercel is UTC, so it would show a purchase entered at 9pm
 * on a summer evening as 8pm. For an accountant matching entries to paper
 * receipts the time has to be right.
 */
export function formatRecordedAt(at: Date, format: TimeFormat = '12h'): string {
  const { date, hour, minute } = dublinClock(at);
  const [year, month, day] = date.split('-');
  const time = formatTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, format);
  return `${day}/${month}/${year} ${time}`;
}
