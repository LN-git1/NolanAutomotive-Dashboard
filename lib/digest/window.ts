const HOUR_MS = 60 * 60 * 1000;

/**
 * The most recent complete `hours`-long window ending on a UTC multiple of
 * `hours` (00:00, 03:00, 06:00 … for the default 3).
 *
 * Aligning to fixed boundaries is what keeps consecutive digests contiguous: a
 * scheduler that fires a few minutes late (GitHub Actions routinely does) would
 * otherwise leave gaps or double-list events between one email and the next.
 */
export function alignedWindow(now: Date, hours = 3): { start: Date; end: Date } {
  const size = hours * HOUR_MS;
  const endMs = Math.floor(now.getTime() / size) * size;
  return { start: new Date(endMs - size), end: new Date(endMs) };
}

/** A window ending right now — for manual previews. */
export function trailingWindow(now: Date, hours: number): { start: Date; end: Date } {
  return { start: new Date(now.getTime() - hours * HOUR_MS), end: now };
}
