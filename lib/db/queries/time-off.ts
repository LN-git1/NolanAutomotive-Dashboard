import 'server-only';

import { and, asc, desc, gte, lte } from 'drizzle-orm';

import { db } from '../index';
import { timeOff, type TimeOff } from '../schema';

/**
 * Entries whose range overlaps `[fromIso, toIso]` at all — not just ones that
 * start inside it. A holiday booked 20 Jul – 5 Aug must still show up when the
 * visible window is August, so the condition is `start <= to AND end >= from`
 * (an overlap test), not `start >= from AND end <= to` (a containment test).
 */
export async function listTimeOffInRange(fromIso: string, toIso: string) {
  return db
    .select()
    .from(timeOff)
    .where(and(lte(timeOff.startDate, toIso), gte(timeOff.endDate, fromIso)))
    .orderBy(asc(timeOff.startDate));
}

/** Every entry, most recent first — for the Settings list. */
export async function listAllTimeOff() {
  return db.select().from(timeOff).orderBy(desc(timeOff.startDate));
}

function eachIsoDate(fromIso: string, toIso: string): string[] {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);

  const dates: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    dates.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return dates;
}

/**
 * Expands a list of (possibly multi-day) entries into one map entry per
 * calendar day, clamped to `[fromIso, toIso]` — the shape `buildMonthGrid`
 * needs to mark individual cells. Value is the entry's label, or `null`.
 */
export function timeOffDateMap(
  entries: TimeOff[],
  fromIso: string,
  toIso: string,
): Map<string, string | null> {
  const map = new Map<string, string | null>();

  for (const entry of entries) {
    const from = entry.startDate > fromIso ? entry.startDate : fromIso;
    const to = entry.endDate < toIso ? entry.endDate : toIso;
    if (from > to) continue;

    for (const date of eachIsoDate(from, to)) map.set(date, entry.label);
  }

  return map;
}
