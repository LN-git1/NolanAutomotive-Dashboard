import 'server-only';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { formatAmount, formatRate } from '@/lib/money';

import { loadInvoiceAssets } from './assets';
import rawCoords from './invoiceTemplateCoords.json';
import {
  assertPageGeometry,
  validateCoords,
  type FieldBox,
  type RowTemplate,
  type StampColor,
  type TemplateCoords,
  type TextAlign,
} from './coords';
import type { SimpleFieldKey } from './fieldKeys';
import { clipToWidth, fitRowsUniformly, fitTextInBox } from './textFit';

/**
 * Coordinate-stamping engine for the Nolan Automotive invoice.
 *
 * The template PDF is treated as an immutable background: it is loaded, never
 * modified, and text is drawn on top of it at coordinates supplied by
 * invoiceTemplateCoords.json. The invoice is NEVER reconstructed as HTML or
 * redrawn — that is the central requirement of this feature.
 */

const COORDS = rawCoords as unknown as TemplateCoords;

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

export interface StampPartLine {
  partName: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
  amount: string;
}

export interface StampInvoiceInput {
  invoiceNumber: string;
  issueDate: Date;

  customerName: string;
  customerAddress?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;

  vehicleRegistration?: string | null;
  vehicleYear?: number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: string | null;
  vehicleMileage?: number | null;
  vehicleVin?: string | null;

  workCarriedOut?: string | null;
  otherComments?: string | null;
  /** Rendered into the comments block when the template has no VAT-number blank. */
  vatNumber?: string | null;

  parts: StampPartLine[];

  servicesSubtotalCents: number;
  partsSubtotalCents: number;
  totalTaxCents: number;
  grandTotalCents: number;
  vatBasisPoints: number;
  vatEnabled: boolean;
}

/** Irish convention: DD/MM/YYYY. */
export function formatIrishDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * How many parts rows the current template can hold. The Invoicer validates
 * against this BEFORE generating, so an over-long parts list becomes a clear
 * form error rather than silently shrinking text into illegibility.
 */
export function partsRowCapacity(): number {
  return COORDS.rowTemplates.partsTable?.maxRows ?? 0;
}

export function serviceRowCapacity(): number {
  return COORDS.rowTemplates.servicesTable?.maxRows ?? 0;
}

/**
 * Assemble the comments block. The template has no dedicated VAT-number blank,
 * so when the business is VAT registered the number is prefixed here rather
 * than invented somewhere on the artwork. See README "Template deviations".
 */
export function buildCommentsBlock(
  otherComments: string | null | undefined,
  vatNumber: string | null | undefined,
): string {
  const segments: string[] = [];
  if (vatNumber && vatNumber.trim()) segments.push(`VAT No: ${vatNumber.trim()}`);
  if (otherComments && otherComments.trim()) segments.push(otherComments.trim());
  return segments.join('\n\n');
}

/**
 * The template prints Year / Make / Model / Colour / Mileage but has no blank
 * for the registration, which an Irish garage invoice is normally expected to
 * show. Rather than float an unlabelled value on the artwork, the registration
 * is appended to the Model line.
 *
 * Either part may be missing, and the combined string is subject to the same
 * fit-and-shrink treatment as any other field, so it can never overflow the
 * printed rule it sits on.
 */
export function buildModelLine(
  model: string | null | undefined,
  registration: string | null | undefined,
): string {
  const parts = [model?.trim(), registration?.trim()].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(' — ');
}

/** Map invoice data onto the closed set of stampable field keys. */
function buildFieldValues(input: StampInvoiceInput): Partial<Record<SimpleFieldKey, string>> {
  const vatRateDisplay = input.vatEnabled ? formatRate(input.vatBasisPoints) : '0';

  return {
    invoiceNumber: input.invoiceNumber,
    issueDate: formatIrishDate(input.issueDate),

    customerName: input.customerName,
    customerAddress: input.customerAddress ?? '',
    customerPhone: input.customerPhone ?? '',
    customerEmail: input.customerEmail ?? '',

    vehicleRegistration: input.vehicleRegistration ?? '',
    vehicleYear: input.vehicleYear ? String(input.vehicleYear) : '',
    vehicleMake: input.vehicleMake ?? '',
    // Carries the registration too — see buildModelLine.
    vehicleModel: buildModelLine(input.vehicleModel, input.vehicleRegistration),
    vehicleColor: input.vehicleColor ?? '',
    vehicleMileage:
      input.vehicleMileage != null ? input.vehicleMileage.toLocaleString('en-IE') : '',
    vehicleVin: input.vehicleVin ?? '',

    workCarriedOut: input.workCarriedOut ?? '',
    otherComments: buildCommentsBlock(input.otherComments, input.vatNumber),
    vatNumber: input.vatNumber ?? '',

    'totals.servicesSubtotal': formatAmount(input.servicesSubtotalCents),
    'totals.servicesTaxRate': vatRateDisplay,
    'totals.partsSubtotal': formatAmount(input.partsSubtotalCents),
    'totals.partsTaxRate': vatRateDisplay,
    'totals.totalServices': formatAmount(input.servicesSubtotalCents),
    'totals.totalParts': formatAmount(input.partsSubtotalCents),
    'totals.totalTax': formatAmount(input.totalTaxCents),
    'totals.grandTotal': formatAmount(input.grandTotalCents),
  };
}

function colorFor(color: StampColor | undefined) {
  return color === 'white' ? WHITE : BLACK;
}

/**
 * The ONLY place text is drawn. Routing every draw through here is what
 * guarantees the colour rule holds — no call site can forget to pass it.
 */
function drawStampText(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    maxWidth: number;
    align?: TextAlign;
    color?: StampColor;
  },
): void {
  if (text === '') return;

  const { x, y, size, font, maxWidth, align = 'left' } = options;
  let drawX = x;

  if (align !== 'left') {
    const measured = font.widthOfTextAtSize(text, size);
    drawX = align === 'right' ? x + maxWidth - measured : x + (maxWidth - measured) / 2;
  }

  page.drawText(text, {
    x: drawX,
    y,
    size,
    font,
    color: colorFor(options.color),
  });
}

function drawField(
  page: PDFPage,
  box: FieldBox,
  value: string,
  fonts: { regular: PDFFont; bold: PDFFont },
): void {
  const trimmed = value.trim();
  if (trimmed === '') return;

  const font = box.bold ? fonts.bold : fonts.regular;

  const fitted = fitTextInBox(trimmed, font, {
    fontSize: box.fontSize,
    minFontSize: box.minFontSize,
    maxWidth: box.maxWidth,
    maxHeight: box.maxHeight,
  });

  fitted.lines.forEach((line, index) => {
    drawStampText(page, line, {
      x: box.x,
      y: box.y - index * fitted.lineHeight,
      size: fitted.fontSize,
      font,
      maxWidth: box.maxWidth,
      align: box.align,
      color: box.color,
    });
  });
}

/** One table row: column key -> cell text. */
type TableRow = Record<string, string>;

function drawTable(
  page: PDFPage,
  template: RowTemplate,
  rows: TableRow[],
  font: PDFFont,
): void {
  if (rows.length === 0) return;

  const visible = rows.slice(0, template.maxRows);

  // Choose one font size that fits every cell, so the table reads evenly
  // rather than as a ragged mix of sizes.
  const cells = visible.flatMap((row) =>
    Object.entries(row).map(([columnKey, text]) => ({
      text,
      maxWidth: template.columns[columnKey]?.width ?? 0,
    })),
  );

  const size = fitRowsUniformly(cells, font, {
    fontSize: template.fontSize,
    minFontSize: template.minFontSize,
  });

  visible.forEach((row, rowIndex) => {
    const y = template.startY - rowIndex * template.rowHeight;

    for (const [columnKey, rawText] of Object.entries(row)) {
      const column = template.columns[columnKey];
      if (!column || rawText === '') continue;

      // At the size floor a cell may still be too wide; clip rather than bleed.
      const text = clipToWidth(rawText, font, size, column.width);

      drawStampText(page, text, {
        x: column.x,
        y,
        size,
        font,
        maxWidth: column.width,
        align: column.align,
        color: template.color,
      });
    }
  });
}

/**
 * The services area of the template is a multi-row table with a description
 * column and an amount column. The free-text "work carried out" is wrapped
 * across those rows, with the labour total placed on the first row.
 */
function buildServiceRows(
  input: StampInvoiceInput,
  template: RowTemplate,
  font: PDFFont,
): TableRow[] {
  const description = (input.workCarriedOut ?? '').trim();
  const amount = formatAmount(input.servicesSubtotalCents);
  const descriptionWidth = template.columns.description?.width ?? 0;

  if (description === '' && input.servicesSubtotalCents === 0) return [];

  const fitted = fitTextInBox(description, font, {
    fontSize: template.fontSize,
    minFontSize: template.minFontSize,
    maxWidth: descriptionWidth,
    maxHeight: template.maxRows * template.rowHeight,
  });

  const lines = fitted.lines.length > 0 ? fitted.lines : [''];

  return lines.slice(0, template.maxRows).map((line, index) => ({
    description: line,
    amount: index === 0 ? amount : '',
  }));
}

function buildPartRows(input: StampInvoiceInput): TableRow[] {
  return input.parts.map((part) => ({
    partName: part.partName,
    partNumber: part.partNumber,
    qty: part.qty,
    unitPrice: formatAmount(Math.round(Number(part.unitPrice) * 100)),
    amount: formatAmount(Math.round(Number(part.amount) * 100)),
  }));
}

/**
 * Stamp an invoice onto the template and return the finished PDF bytes.
 *
 * Pure with respect to the database and storage — the caller decides whether
 * the result is a throwaway preview or the finalised artefact. That separation
 * is what lets the Invoicer preview freely without consuming an invoice number.
 */
export async function stampInvoice(input: StampInvoiceInput): Promise<Uint8Array> {
  validateCoords(COORDS);

  if (input.parts.length > partsRowCapacity()) {
    throw new Error(
      `This invoice has ${input.parts.length} part lines but the template only has room for ` +
        `${partsRowCapacity()}. Consolidate the lines or issue a second invoice.`,
    );
  }

  const assets = await loadInvoiceAssets();
  const pdfDoc = await PDFDocument.load(assets.template);

  // Register fontkit and embed a real TrueType face. pdf-lib's built-in
  // Helvetica is WinAnsi-encoded and THROWS on any character outside CP1252 —
  // which a Polish or Lithuanian customer name in Ireland will readily produce.
  pdfDoc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    pdfDoc.embedFont(assets.regular, { subset: true }),
    pdfDoc.embedFont(assets.bold, { subset: true }),
  ]);

  const page = pdfDoc.getPage(0);
  assertPageGeometry(page.getSize(), COORDS.pageSize);

  const values = buildFieldValues(input);

  for (const [key, box] of Object.entries(COORDS.fields)) {
    if (!box) continue;
    const value = values[key as SimpleFieldKey];
    if (value === undefined) continue;
    drawField(page, box, value, { regular, bold });
  }

  const servicesTemplate = COORDS.rowTemplates.servicesTable;
  if (servicesTemplate) {
    drawTable(page, servicesTemplate, buildServiceRows(input, servicesTemplate, regular), regular);
  }

  const partsTemplate = COORDS.rowTemplates.partsTable;
  if (partsTemplate) {
    drawTable(page, partsTemplate, buildPartRows(input), regular);
  }

  return pdfDoc.save();
}
