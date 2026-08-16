/**
 * The closed set of field keys that may appear in `invoiceTemplateCoords.json`.
 *
 * This module is the single source of truth shared by BOTH:
 *   - the Template Mapper dev tool (populates its field picklist from here), and
 *   - the stamping engine (`lib/pdf/stamp.ts`, looks up values by these keys).
 *
 * Because the mapper can only ever assign a key from this list, the stamper can
 * never encounter a key it does not understand. Adding a stampable field is a
 * one-line change here plus a case in `buildStampValues()`.
 *
 * A key present here but absent from the coords JSON is simply not stamped —
 * that is the intended escape hatch for data the template has no blank for
 * (e.g. vehicle registration, VAT number). See README "Template deviations".
 */

export const SIMPLE_FIELD_KEYS = [
  // Invoice header
  'invoiceNumber',
  'issueDate',

  // Customer block
  'customerName',
  'customerAddress',
  'customerPhone',
  'customerEmail',

  // Vehicle block. The template prints "Make:" and "Model:" on separate lines,
  // so these are stored and stamped separately rather than as one combined field.
  'vehicleRegistration',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleColor',
  'vehicleMileage',
  'vehicleVin',

  // Free-text blocks. The work carried out is no longer a single free-text box —
  // it is the labourTable below, one row per line with its own hours.
  'otherComments',
  'vatNumber',

  // Totals. The template has a SUBTOTAL + TAX RATE pair under BOTH the labour
  // table and the parts table, then a four-line summary block at the bottom.
  // These are the only places the labour figure appears in euro — the labour
  // table itself prints hours.
  'totals.labourSubtotal',
  'totals.labourTaxRate',
  'totals.partsSubtotal',
  'totals.partsTaxRate',
  'totals.totalLabour',
  'totals.totalParts',
  'totals.totalTax',
  'totals.grandTotal',
] as const;

export type SimpleFieldKey = (typeof SIMPLE_FIELD_KEYS)[number];

/** Repeating-row tables. Geometry is defined once as a row template, not per row. */
export const ROW_TEMPLATE_KEYS = ['labourTable', 'partsTable'] as const;
export type RowTemplateKey = (typeof ROW_TEMPLATE_KEYS)[number];

/**
 * Column keys per row template, in left-to-right template order.
 *
 * The labour table's second column is HOUR(S), not money. It was `amount` until
 * the template was reworked; the geometry is unchanged, only the meaning.
 */
export const ROW_TEMPLATE_COLUMNS = {
  labourTable: ['description', 'hours'],
  partsTable: ['partName', 'partNumber', 'qty', 'unitPrice', 'amount'],
} as const;

export type LabourRowColumn = (typeof ROW_TEMPLATE_COLUMNS)['labourTable'][number];
export type PartsRowColumn = (typeof ROW_TEMPLATE_COLUMNS)['partsTable'][number];
export type RowTemplateColumn = LabourRowColumn | PartsRowColumn;

/** Human-readable labels for the Template Mapper picklist. */
export const FIELD_KEY_LABELS: Record<SimpleFieldKey, string> = {
  invoiceNumber: 'Invoice number',
  issueDate: 'Invoice date',
  customerName: 'Customer — name',
  customerAddress: 'Customer — address',
  customerPhone: 'Customer — phone number',
  customerEmail: 'Customer — email',
  vehicleRegistration: 'Vehicle — registration',
  vehicleYear: 'Vehicle — year',
  vehicleMake: 'Vehicle — make',
  vehicleModel: 'Vehicle — model',
  vehicleColor: 'Vehicle — colour',
  vehicleMileage: 'Vehicle — mileage',
  vehicleVin: 'Vehicle — VIN',
  otherComments: 'Other comments',
  vatNumber: 'VAT number',
  'totals.labourSubtotal': 'Labour — subtotal (€)',
  'totals.labourTaxRate': 'Labour — tax rate (%)',
  'totals.partsSubtotal': 'Parts — subtotal (€)',
  'totals.partsTaxRate': 'Parts — tax rate (%)',
  'totals.totalLabour': 'Total labour (€)',
  'totals.totalParts': 'Total parts (€)',
  'totals.totalTax': 'Total tax (€)',
  'totals.grandTotal': 'Grand total (€)',
};

export const ROW_TEMPLATE_LABELS: Record<RowTemplateKey, string> = {
  labourTable: 'Work carried out — description + hours (repeating rows)',
  partsTable: 'Parts table (repeating rows)',
};

export function isSimpleFieldKey(value: string): value is SimpleFieldKey {
  return (SIMPLE_FIELD_KEYS as readonly string[]).includes(value);
}

export function isRowTemplateKey(value: string): value is RowTemplateKey {
  return (ROW_TEMPLATE_KEYS as readonly string[]).includes(value);
}
