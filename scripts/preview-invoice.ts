/**
 * Render a sample invoice to /tmp so template coordinates can be eyeballed
 * without going through the UI or touching the database.
 *
 *   pnpm invoice:preview
 *
 * Deliberately uses the worst case rather than a tidy one: BOTH tables filled to
 * the template's stated capacity, over-long descriptions, an accented customer
 * name and a multi-line address. Those are the inputs that expose bad
 * coordinates, row collisions and text-fitting bugs — a three-line invoice
 * proves nothing.
 */

import { writeFile } from 'node:fs/promises';

import { calcInvoiceTotals } from '../lib/money';
import {
  labourRowCapacity,
  partsRowCapacity,
  stampInvoice,
  type StampLabourLine,
  type StampPartLine,
} from '../lib/pdf/stamp';

const OUTPUT_PATH = '/tmp/nolan-invoice-preview.pdf';

async function main() {
  const labourCapacity = labourRowCapacity();
  const partsCapacity = partsRowCapacity();

  const allLabour: StampLabourLine[] = [
    { description: 'Front brake overhaul — pads, discs, calliper slide pins cleaned', hours: '2.5' },
    { description: 'Timing belt, tensioner, idler and water pump replaced', hours: '4' },
    { description: 'Full service: engine oil, oil filter, air and pollen filters', hours: '1.5' },
    { description: 'Coolant drained, system flushed and refilled', hours: '0.75' },
    { description: 'Diagnostic scan and fault code clearance', hours: '1' },
    { description: 'Road tested — braking even, no belt noise, temperature stable', hours: '0.25' },
    { description: 'Wheel alignment check', hours: '0.5' },
  ];

  const allParts = [
    { partName: 'Brake pads (front axle set)', partNumber: 'BP-4417', qty: '1', unitPrice: '68.50' },
    { partName: 'Brake discs, vented 280mm', partNumber: 'BD-2280', qty: '2', unitPrice: '54.00' },
    { partName: 'Engine oil 5W-30 fully synthetic', partNumber: 'OIL-530', qty: '4.5', unitPrice: '9.20' },
    { partName: 'Oil filter', partNumber: 'OF-119', qty: '1', unitPrice: '11.75' },
    { partName: 'Air filter element', partNumber: 'AF-303', qty: '1', unitPrice: '18.40' },
    { partName: 'Timing belt kit with water pump', partNumber: 'TBK-2210', qty: '1', unitPrice: '164.00' },
    { partName: 'Coolant G13 concentrate 1.5L', partNumber: 'CL-G13', qty: '2', unitPrice: '14.95' },
  ];

  // Fill each table exactly to capacity, so the last row's clearance above the
  // subtotal band is what actually gets looked at.
  const labourLines = allLabour.slice(0, labourCapacity);
  const parts = allParts.slice(0, partsCapacity);

  const totals = calcInvoiceTotals({
    labourLines,
    hourlyRate: '65.00',
    parts,
    vatRate: '23',
    vatEnabled: true,
  });

  const stampParts: StampPartLine[] = totals.parts.map((part) => ({
    partName: part.partName,
    partNumber: part.partNumber,
    qty: String(part.qty),
    unitPrice: String(part.unitPrice),
    amount: part.amount,
  }));

  const bytes = await stampInvoice({
    invoiceNumber: 'NA-2026-0042',
    issueDate: new Date('2026-08-12T10:00:00Z'),

    customerName: 'Séamus Ó Súilleabháin',
    customerAddress: '14 Corbally Heights\nKilcock, Co. Kildare\nW23 XY12',
    customerPhone: '(087) 555-0134',

    vehicleRegistration: '181-KE-4429',
    vehicleYear: 2018,
    vehicleMake: 'Volkswagen',
    vehicleModel: 'Golf 1.6 TDI Comfortline',
    vehicleColor: 'Deep Black Pearl',
    vehicleMileage: 148_320,

    labourLines,
    otherComments: 'Rear pads at approximately 40% — recommend replacing at next service.',
    vatNumber: 'IE1234567FA',

    parts: stampParts,
    partsIsOverridden: totals.partsIsOverridden,

    labourSubtotalCents: totals.labourSubtotalCents,
    partsSubtotalCents: totals.partsSubtotalCents,
    totalTaxCents: totals.totalTaxCents,
    grandTotalCents: totals.grandTotalCents,
    vatBasisPoints: totals.vatBasisPoints,
    vatEnabled: true,
  });

  await writeFile(OUTPUT_PATH, bytes);

  console.log(`Wrote ${bytes.length} bytes to ${OUTPUT_PATH}`);
  console.log(`  labour rows       : ${labourLines.length} of ${labourCapacity}`);
  console.log(`  parts rows        : ${parts.length} of ${partsCapacity}`);
  console.log(`  total hours       : ${totals.totalHoursCentis / 100}`);
  console.log(`  labour subtotal   : ${totals.labourSubtotalCents / 100}`);
  console.log(`  parts subtotal    : ${totals.partsSubtotalCents / 100}`);
  console.log(`  total tax         : ${totals.totalTaxCents / 100}`);
  console.log(`  grand total       : ${totals.grandTotalCents / 100}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
