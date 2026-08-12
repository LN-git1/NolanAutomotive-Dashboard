import {
  ROW_TEMPLATE_KEYS,
  isRowTemplateKey,
  isSimpleFieldKey,
  type RowTemplateKey,
  type SimpleFieldKey,
} from './fieldKeys';

/**
 * Shape of `invoiceTemplateCoords.json` — the contract between the Template
 * Mapper (which writes it) and the stamping engine (which reads it).
 *
 * Coordinates are PDF user-space points with the origin at the BOTTOM-LEFT of
 * the page, matching pdf-lib. `y` is the text baseline of the first line.
 */

export type TextAlign = 'left' | 'center' | 'right';

/**
 * Stamped text is pure black everywhere per the invoice specification.
 *
 * The single exception is the dark charcoal "INVOICE # / DATE" banner near the
 * top of the template, where the pre-printed labels are themselves white and
 * black text would be illegible. Those two fields — and only those two — are
 * mapped as `white`. See README "Template deviations".
 */
export type StampColor = 'black' | 'white';

export interface FieldBox {
  x: number;
  y: number;
  maxWidth: number;
  /** Omit for single-line fields that have no vertical room to negotiate. */
  maxHeight?: number;
  fontSize: number;
  minFontSize: number;
  align?: TextAlign;
  color?: StampColor;
  bold?: boolean;
}

export interface RowColumn {
  x: number;
  width: number;
  align?: TextAlign;
}

export interface RowTemplate {
  /** Baseline of the first row. Row n sits at `startY - n * rowHeight`. */
  startY: number;
  rowHeight: number;
  /** Hard cap. Exceeding this is a validation error, never a silent overflow. */
  maxRows: number;
  fontSize: number;
  minFontSize: number;
  color?: StampColor;
  columns: Record<string, RowColumn>;
}

export interface TemplateCoords {
  pageSize: { width: number; height: number };
  fields: Partial<Record<SimpleFieldKey, FieldBox>>;
  rowTemplates: Partial<Record<RowTemplateKey, RowTemplate>>;
}

/**
 * The template is US Letter (612 x 792pt), NOT A4.
 *
 * This was measured from the supplied file rather than assumed. The build brief
 * asked for A4 output, but the template is the immutable artefact and rescaling
 * it to A4 would visibly alter the artwork — which the brief forbids more
 * emphatically. Template fidelity wins; see README "Template deviations".
 */
export const TEMPLATE_PAGE_WIDTH = 612;
export const TEMPLATE_PAGE_HEIGHT = 792;

/** Tolerance in points when comparing the loaded page against the expected size. */
const PAGE_SIZE_TOLERANCE = 1;

/**
 * Fail loudly if the template file has been re-exported at a different page
 * size. Without this check every coordinate would silently shift and the
 * corruption would only be visible by eye on a finished invoice.
 */
export function assertPageGeometry(
  actual: { width: number; height: number },
  expected: { width: number; height: number },
): void {
  const widthOk = Math.abs(actual.width - expected.width) <= PAGE_SIZE_TOLERANCE;
  const heightOk = Math.abs(actual.height - expected.height) <= PAGE_SIZE_TOLERANCE;

  if (!widthOk || !heightOk) {
    throw new Error(
      `Invoice template page size mismatch. Expected ${expected.width}x${expected.height}pt, ` +
        `got ${actual.width}x${actual.height}pt. The template PDF has been replaced or re-exported; ` +
        `re-run the Template Mapper (TEMPLATE_MAPPER=true) to regenerate invoiceTemplateCoords.json.`,
    );
  }
}

/** Reject a coords file containing keys the stamper would not understand. */
export function validateCoords(coords: TemplateCoords): void {
  for (const key of Object.keys(coords.fields)) {
    if (!isSimpleFieldKey(key)) {
      throw new Error(
        `invoiceTemplateCoords.json contains unknown field key "${key}". ` +
          `Valid keys are defined in lib/pdf/fieldKeys.ts.`,
      );
    }
  }

  for (const key of Object.keys(coords.rowTemplates)) {
    if (!isRowTemplateKey(key)) {
      throw new Error(
        `invoiceTemplateCoords.json contains unknown row template "${key}". ` +
          `Valid row templates are: ${ROW_TEMPLATE_KEYS.join(', ')}.`,
      );
    }
  }

  for (const [key, template] of Object.entries(coords.rowTemplates)) {
    if (template && template.maxRows < 1) {
      throw new Error(`Row template "${key}" has maxRows < 1, which would stamp nothing.`);
    }
  }
}

/** Row capacity for a table, used by validation before generating a PDF. */
export function maxRowsFor(coords: TemplateCoords, key: RowTemplateKey): number {
  return coords.rowTemplates[key]?.maxRows ?? 0;
}
