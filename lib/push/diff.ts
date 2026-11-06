/**
 * The ids in `after` that were not in `before`: who has just been added.
 *
 * Kept in its own tiny file, with no imports, so a server action can use it
 * without pulling the push code (the database, the push library) into every
 * page that merely contains the action.
 */
export function newlyAdded(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before);
  return [...new Set(after)].filter((id) => !had.has(id));
}
