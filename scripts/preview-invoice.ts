/**
 * Render a sample invoice to /tmp so template coordinates can be eyeballed
 * without going through the UI or touching the database.
 *
 *   pnpm invoice:preview
 *
 * Deliberately uses awkward sample data — a long work description, a full parts
 * table, an accented customer name and a two-line address — because those are
 * the cases that expose bad coordinates and text-fitting bugs.
 */

import { writeFile } from 'node:fs/promises';

import { calcInvoiceTotals } from '../lib/money';
import { stampInvoice, type StampPartLine } from '../lib/pdf/stamp';

const OUTPUT_PATH = '/tmp/nolan-invoice-preview.pdf';

async function main() {
  const parts = [
    { partName: 'Brake pads (front axle set)', partNumber: 'BP-4417', qty: '1', unitPrice: '68.50' },
    { partName: 'Brake discs, vented 280mm', partNumber: 'BD-2280', qty: '2', unitPrice: '54.00' },
    { partName: 'Engine oil 5W-30 fully synthetic', partNumber: 'OIL-530', qty: '4.5', unitPrice: '9.20' },
    { partName: 'Oil filter', partNumber: 'OF-119', qty: '1', unitPrice: '11.75' },
    { partName: 'Air filter element', partNumber: 'AF-303', qty: '1', unitPrice: '18.40' },
  ];

  const totals = calcInvoiceTotals({
    labourHours: '3.5',
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

    workCarriedOut:
      'Full front brake overhaul: replaced front pads and discs, cleaned and greased ' +
      'calliper slide pins, bled brake circuit and replaced fluid. Carried out full ' +
      'service — engine oil, oil filter and air filter replaced. Road tested; brakes ' +
      'bedded in correctly and no pull under braking.',
    otherComments: 'Rear pads at approximately 40% — recommend replacing at next service.',
    vatNumber: 'IE1234567FA',

    parts: stampParts,

    servicesSubtotalCents: totals.servicesSubtotalCents,
    partsSubtotalCents: totals.partsSubtotalCents,
    totalTaxCents: totals.totalTaxCents,
    grandTotalCents: totals.grandTotalCents,
    vatBasisPoints: totals.vatBasisPoints,
    vatEnabled: true,
  });

  await writeFile(OUTPUT_PATH, bytes);

  console.log(`Wrote ${bytes.length} bytes to ${OUTPUT_PATH}`);
  console.log(`  services subtotal : ${totals.servicesSubtotalCents / 100}`);
  console.log(`  parts subtotal    : ${totals.partsSubtotalCents / 100}`);
  console.log(`  total tax         : ${totals.totalTaxCents / 100}`);
  console.log(`  grand total       : ${totals.grandTotalCents / 100}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
