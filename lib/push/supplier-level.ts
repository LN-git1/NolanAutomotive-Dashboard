/**
 * Where a supplier account stands against its limit. Pure maths with no
 * imports, so it is easy to test and safe to load from anywhere.
 *
 * There are two alerts per supplier: one when the balance reaches 80% of the
 * limit and one when it reaches the limit itself. Each fires once, then stays
 * quiet until the balance has fallen back below its line, so a bill hovering
 * around 80% does not buzz the phone on every purchase. The once-only part
 * lives in `supplier-limits.ts`, next to the database writes that enforce it.
 */
export type SupplierLevel = 'below' | 'warn' | 'full';

/**
 * `balanceCents` is signed (negative is a credit with the supplier); a
 * `limitCents` of zero or less means no usable limit, so nothing ever fires.
 * Integer arithmetic throughout: `balance * 5 >= limit * 4` is "at least 80%"
 * without a floating-point division that could round either way.
 */
export function supplierLevel(balanceCents: number, limitCents: number): SupplierLevel {
  if (!(limitCents > 0)) return 'below';
  if (balanceCents >= limitCents) return 'full';
  if (balanceCents * 5 >= limitCents * 4) return 'warn';
  return 'below';
}
