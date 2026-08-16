/**
 * Every euro amount in this app passes through here.
 *
 * Two reasons this module exists rather than inline arithmetic:
 *
 *  1. Drizzle returns Postgres `numeric` columns as JS *strings*, not numbers.
 *     That is correct (it avoids IEEE-754 drift) but it means `row.total * 1.23`
 *     silently produces garbage. Everything below takes strings deliberately.
 *
 *  2. Invoice totals are legally meaningful. All arithmetic is done in integer
 *     cents; nothing is ever multiplied as a float.
 */

/** Parse a decimal money string ("1,234.56", "1234.5", 1234) into integer cents. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;

  const raw = String(value).trim().replace(/[\s,€]/g, '');
  if (raw === '' || raw === '-') return 0;

  if (!/^-?\d*\.?\d*$/.test(raw)) {
    throw new Error(`Invalid monetary value: ${String(value)}`);
  }

  const negative = raw.startsWith('-');
  const abs = negative ? raw.slice(1) : raw;
  const [intPart = '0', fracPart = ''] = abs.split('.');

  const whole = Number(intPart === '' ? '0' : intPart);
  const hundredths = Number((fracPart + '00').slice(0, 2) || '0');
  // Round half-up on the third decimal rather than truncating.
  const third = fracPart.length > 2 ? Number(fracPart[2]) : 0;

  let cents = whole * 100 + hundredths + (third >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) throw new Error(`Invalid monetary value: ${String(value)}`);
  if (negative) cents = -cents;

  return cents;
}

/** Render integer cents as a plain decimal string suitable for a numeric column. */
export function fromCents(cents: number): string {
  const rounded = Math.round(cents);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Parse a percentage rate ("23", "23.00", "13.5") into basis points
 * (hundredths of a percent), so 23% -> 2300. Integer maths again.
 */
export function rateToBasisPoints(rate: string | number | null | undefined): number {
  if (rate === null || rate === undefined || rate === '') return 0;
  return toCents(rate); // identical decimal-string parse: 23.00 -> 2300
}

/** Apply a basis-point rate to a cents amount, rounding half-up to the cent. */
export function applyRate(cents: number, basisPoints: number): number {
  if (basisPoints === 0) return 0;
  return Math.round((cents * basisPoints) / 10_000);
}

/** Thousands-separated display string, e.g. 123456 -> "1,234.56". No symbol. */
export function formatAmount(cents: number): string {
  const plain = fromCents(cents);
  const negative = plain.startsWith('-');
  const [intPart, fracPart] = (negative ? plain.slice(1) : plain).split('.');
  const grouped = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fracPart}`;
}

/** Display string with the euro symbol, for the dashboard UI (not the PDF). */
export function formatEur(cents: number): string {
  return `€${formatAmount(cents)}`;
}

/** Render a basis-point rate back to a percentage string, e.g. 2300 -> "23". */
export function formatRate(basisPoints: number): string {
  const asString = fromCents(basisPoints);
  return asString.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export interface PartLineInput {
  partName: string;
  partNumber: string;
  /** Quantity may be fractional (e.g. 2.5 litres of oil). */
  qty: string | number;
  unitPrice: string | number;
}

export interface PartLineComputed extends PartLineInput {
  /** qty x unitPrice, as a decimal string. */
  amount: string;
}

export interface LabourLineInput {
  description: string;
  /** Hours may be fractional ("2.5") or empty for a line with no billable time. */
  hours: string | number | null | undefined;
}

export interface InvoiceTotalsInput {
  /** One entry per printed WORK CARRIED OUT row. Hours are summed for the total. */
  labourLines: LabourLineInput[];
  hourlyRate: string | number | null | undefined;
  /** A flat labour figure. When set it replaces hours x rate entirely. */
  labourTotalOverride?: string | number | null;
  parts: PartLineInput[];
  /** Percentage, e.g. "23". Ignored entirely when vatEnabled is false. */
  vatRate: string | number | null | undefined;
  vatEnabled: boolean;
}

export interface InvoiceTotals {
  /** Line amounts computed per part row. */
  parts: PartLineComputed[];
  /** Sum of the labour lines' hours, in hundredths of an hour. */
  totalHoursCentis: number;
  /** True when the flat override supplied the labour figure. */
  labourIsOverridden: boolean;
  labourSubtotalCents: number;
  partsSubtotalCents: number;
  vatBasisPoints: number;
  labourTaxCents: number;
  partsTaxCents: number;
  totalTaxCents: number;
  grandTotalCents: number;
}

/**
 * Sum labour hours in hundredths, so 2.5 + 0.25 is exact rather than 2.75 by way
 * of IEEE-754. `toCents` is the same decimal-string parse used for money, which
 * is why it is reused rather than reimplemented for hours.
 */
export function sumLabourHours(lines: LabourLineInput[]): number {
  return lines.reduce((sum, line) => sum + toCents(line.hours), 0);
}

/** Render summed hundredth-hours for display: 250 -> "2.5", 1000 -> "10". */
export function formatHours(centis: number): string {
  return fromCents(centis)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

/**
 * The single definition of how an invoice adds up.
 *
 * Reading of the template's totals block: TOTAL LABOUR and TOTAL PARTS are the
 * ex-VAT subtotals, TOTAL TAX is the combined VAT on both, and TOTAL is the sum
 * of all three. VAT is computed per component and then summed (rather than on
 * the combined subtotal) so each component's tax line is individually correct.
 *
 * Labour is the sum of the lines' hours multiplied by the rate — UNLESS a flat
 * override is set, in which case that figure is the labour total outright. The
 * hours are still carried through either way, because the template prints them
 * per line regardless of how the money was arrived at.
 *
 * When VAT is not enabled the rate and every tax amount are forced to zero.
 */
export function calcInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const totalHoursCentis = sumLabourHours(input.labourLines);

  const override = input.labourTotalOverride;
  const labourIsOverridden =
    override !== null && override !== undefined && String(override).trim() !== '';

  const labourCents = labourIsOverridden
    ? toCents(override)
    : // hundredth-hours x cents-per-hour / 100 = cents.
      // e.g. 3.5h at EUR 65 -> 350 * 6500 / 100 = 22_750 cents.
      Math.round((totalHoursCentis * toCents(input.hourlyRate)) / 100);

  const parts: PartLineComputed[] = input.parts.map((part) => ({
    ...part,
    amount: fromCents(applyQuantity(part.qty, part.unitPrice)),
  }));

  const partsSubtotalCents = parts.reduce((sum, part) => sum + toCents(part.amount), 0);
  const vatBasisPoints = input.vatEnabled ? rateToBasisPoints(input.vatRate) : 0;

  const labourTaxCents = applyRate(labourCents, vatBasisPoints);
  const partsTaxCents = applyRate(partsSubtotalCents, vatBasisPoints);
  const totalTaxCents = labourTaxCents + partsTaxCents;

  return {
    parts,
    totalHoursCentis,
    labourIsOverridden,
    labourSubtotalCents: labourCents,
    partsSubtotalCents,
    vatBasisPoints,
    labourTaxCents,
    partsTaxCents,
    totalTaxCents,
    grandTotalCents: labourCents + partsSubtotalCents + totalTaxCents,
  };
}

/**
 * Multiply a (possibly fractional) quantity by a unit price without floats.
 * Quantity is taken to 4 decimal places, which is far beyond anything a garage
 * will enter but keeps 1/3-style values from drifting.
 *
 * Exported so the job form's live parts-total preview can share this exact
 * arithmetic rather than a hand-rolled approximation — the preview and the
 * stamped invoice must never disagree on a part's line total.
 */
export function applyQuantity(
  quantity: string | number | null | undefined,
  unitPrice: string | number | null | undefined,
): number {
  const qtyTenThousandths = Math.round(parseDecimal(quantity) * 10_000);
  const priceCents = toCents(unitPrice);
  return Math.round((qtyTenThousandths * priceCents) / 10_000);
}

function parseDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).trim().replace(/,/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${String(value)}`);
  }
  return parsed;
}
