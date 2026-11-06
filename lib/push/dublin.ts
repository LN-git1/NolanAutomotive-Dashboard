/**
 * The garage runs on Irish time, but the server runs on UTC. Anything that
 * means "today" or "9am" has to be worked out in Europe/Dublin, or a job booked
 * for today reads as yesterday's between midnight and 1am in summer.
 */
const DUBLIN = 'Europe/Dublin';

export interface DublinClock {
  /** `YYYY-MM-DD` in Dublin. */
  date: string;
  /** 0-23 in Dublin. */
  hour: number;
  minute: number;
}

export function dublinClock(at: Date): DublinClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** The morning summary goes out from 9am until this hour, to ride out a late scheduler. */
export const MORNING_HOUR = 9;
export const MORNING_CUTOFF_HOUR = 12;

/**
 * True when it is time to send the morning summary: Dublin time is 9am or
 * later, but before midday. GitHub's scheduler can start a run late, so this
 * is a window, not "hour equals 9"; the once-per-day claim stops a second send.
 */
export function isMorningWindow(at: Date): boolean {
  const { hour } = dublinClock(at);
  return hour >= MORNING_HOUR && hour < MORNING_CUTOFF_HOUR;
}
