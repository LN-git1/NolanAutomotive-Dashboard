import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizeRegistration } from '@/lib/db/queries/vehicles';

/**
 * The registration lookup and the workshop/invoiced/paid split.
 *
 * `normalizeRegistration` is pure and runs everywhere. Everything below it
 * needs a real Postgres — the whole point of these queries is a correlated
 * subquery, a LATERAL join and an indexed expression, none of which a mock can
 * demonstrate anything about. Same gate as `awaiting-payment.test.ts`:
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
 */

describe('normalizeRegistration', () => {
  /**
   * Plates are stored as typed because that is what prints on the invoice, so
   * every one of these is a legitimate way for the same car to be in the
   * database — and a legitimate way for the owner to search for it.
   */
  it('reduces every punctuation of one plate to the same key', () => {
    const forms = ['142-KY-9821', '142KY9821', '142 ky 9821', '142.ky.9821', ' 142-ky-9821 '];
    const keys = new Set(forms.map(normalizeRegistration));

    expect(keys).toEqual(new Set(['142KY9821']));
  });

  it('does not merge genuinely different plates', () => {
    expect(normalizeRegistration('98-D-1')).not.toBe(normalizeRegistration('98-D-11'));
  });

  it('survives an empty or punctuation-only value', () => {
    expect(normalizeRegistration('')).toBe('');
    expect(normalizeRegistration('---')).toBe('');
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('vehicle history and the workshop/invoiced split', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let jobs: (typeof import('@/lib/db/schema'))['jobs'];
  let invoices: (typeof import('@/lib/db/schema'))['invoices'];
  let payments: (typeof import('@/lib/db/schema'))['payments'];
  let searchVehicles: (typeof import('@/lib/db/queries/vehicles'))['searchVehicles'];
  let getVehicleHistory: (typeof import('@/lib/db/queries/vehicles'))['getVehicleHistory'];
  let findJobByRegistration: (typeof import('@/lib/db/queries/jobs'))['findJobByRegistration'];
  let listJobs: (typeof import('@/lib/db/queries/jobs'))['listJobs'];
  let countAwaitingPaymentJobs: (typeof import('@/lib/db/queries/jobs'))['countAwaitingPaymentJobs'];

  /** Unique per run, so a match can never be another test's row. */
  const stamp = randomUUID().slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  const customer = `Vehicle Lookup ${stamp}`;

  // One car entered two different ways, plus a second car for the same
  // customer. `98D` must find both cars, and the first must be ONE row.
  const regHyphen = `98-D-${stamp}`;
  const regPlain = `98D${stamp}`;
  const regOther = `98-D-X${stamp}`;

  const jobA = randomUUID();
  const jobB = randomUUID();
  const jobC = randomUUID();
  const invA = randomUUID();
  const invB = randomUUID();
  const invVoided = randomUUID();
  const jobIds = [jobA, jobB, jobC];

  function invoice(id: string, jobId: string, total: string) {
    return {
      id,
      jobId,
      invoiceNumber: `TEST-VL-${id.slice(0, 8)}`,
      issueDate: '2026-01-01',
      labourSubtotal: total,
      partsSubtotal: '0.00',
      vatRate: '0.00',
      vatAmount: '0.00',
      totalLabour: total,
      totalParts: '0.00',
      grandTotal: total,
      parts: [],
      pdfStoragePath: 'test/vehicle-lookup.pdf',
    };
  }

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    ({ jobs, invoices, payments } = await import('@/lib/db/schema'));
    ({ searchVehicles, getVehicleHistory } = await import('@/lib/db/queries/vehicles'));
    ({ findJobByRegistration, listJobs, countAwaitingPaymentJobs } = await import(
      '@/lib/db/queries/jobs'
    ));

    await db.insert(jobs).values([
      {
        id: jobA,
        jobNumber: `TEST-VLA-${stamp}`,
        customerName: customer,
        customerPhone: '0871111111',
        vehicleRegistration: regHyphen,
        vehicleMake: 'Toyota',
        vehicleModel: 'Corolla',
      },
      {
        id: jobB,
        jobNumber: `TEST-VLB-${stamp}`,
        customerName: customer,
        customerPhone: '0872222222',
        vehicleRegistration: regPlain,
        vehicleMake: 'Toyota',
        vehicleModel: 'Corolla',
      },
      {
        id: jobC,
        jobNumber: `TEST-VLC-${stamp}`,
        customerName: customer,
        vehicleRegistration: regOther,
        vehicleMake: 'Nissan',
      },
    ]);

    await db.insert(invoices).values([
      invoice(invA, jobA, '300.00'),
      invoice(invB, jobB, '450.50'),
      // Voided: its EUR 999 must never reach a total.
      { ...invoice(invVoided, jobC, '999.00'), voidedAt: new Date() },
    ]);

    await db.insert(payments).values([
      { invoiceId: invA, amount: '300.00' },
      // Partial, so "paid" and "billed" cannot be the same number by accident.
      { invoiceId: invB, amount: '100.50' },
    ]);
  });

  afterAll(async () => {
    await db.delete(payments).where(inArray(payments.invoiceId, [invA, invB, invVoided]));
    await db.delete(invoices).where(inArray(invoices.id, [invA, invB, invVoided]));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  });

  /**
   * The reason this whole thing is keyed on a normalised expression rather than
   * the stored text. Booked in once as `98-D-1234` and once as `98D1234`, it is
   * one car — and a lookup that showed it twice would be offering the owner a
   * choice between two halves of the same history.
   */
  it('collapses the punctuations of one plate into a single vehicle', async () => {
    const rows = await searchVehicles(`98D${stamp}`);
    const car = rows.filter((row) => row.normalizedRegistration === `98D${stamp}`);

    expect(car).toHaveLength(1);
    expect(car[0]?.jobCount).toBe(2);
  });

  it('finds a car from a fragment of its plate, as the owner actually types it', async () => {
    // `98D` is the real query — "one of the 98 Dublin cars" — narrowed by the
    // run's stamp so the assertion is about this test's rows.
    const rows = await searchVehicles(`98D${stamp}`.slice(0, 3) + stamp.slice(0, 2));
    expect(rows.length).toBeGreaterThan(0);

    for (const spelling of [regHyphen, regPlain, `98 d ${stamp}`, regPlain.toLowerCase()]) {
      const found = await searchVehicles(spelling);
      expect(
        found.some((row) => row.normalizedRegistration === `98D${stamp}`),
        `searching "${spelling}" should find the car`,
      ).toBe(true);
    }
  });

  it('totals what the vehicle has been billed and paid across all its jobs', async () => {
    const [car] = (await searchVehicles(`98D${stamp}`)).filter(
      (row) => row.normalizedRegistration === `98D${stamp}`,
    );

    // 300.00 + 450.50 billed, 300.00 + 100.50 received.
    expect(car?.totalBilledCents).toBe(75_050);
    expect(car?.totalPaidCents).toBe(40_050);
  });

  /**
   * Voiding never deletes, so the row is still there to be summed by anything
   * that forgets to exclude it — and a void is precisely the case where the
   * customer does NOT owe the money.
   */
  it('leaves a voided invoice out of the vehicle total', async () => {
    const [car] = (await searchVehicles(regOther)).filter(
      (row) => row.normalizedRegistration === normalizeRegistration(regOther),
    );

    expect(car).toBeDefined();
    expect(car?.totalBilledCents).toBe(0);
  });

  it('finds every car a customer has had in, searching by their name', async () => {
    const rows = await searchVehicles(customer);
    const found = new Set(rows.map((row) => row.normalizedRegistration));

    expect(found).toContain(`98D${stamp}`);
    expect(found).toContain(normalizeRegistration(regOther));
  });

  it('carries the details a returning customer should prefill from', async () => {
    const [car] = (await searchVehicles(`98D${stamp}`)).filter(
      (row) => row.normalizedRegistration === `98D${stamp}`,
    );

    expect(car?.customerName).toBe(customer);
    expect(car?.vehicleMake).toBe('Toyota');
    expect(car?.vehicleModel).toBe('Corolla');
    // Display keeps the spelling of the most recent visit, not the search term.
    expect([regHyphen, regPlain]).toContain(car?.registration);
  });

  it('lists both jobs in the vehicle history whichever spelling is asked for', async () => {
    const history = await getVehicleHistory(`98 d ${stamp}`);
    const numbers = history.map((entry) => entry.jobNumber);

    expect(numbers).toContain(`TEST-VLA-${stamp}`);
    expect(numbers).toContain(`TEST-VLB-${stamp}`);
    expect(history.find((e) => e.jobNumber === `TEST-VLB-${stamp}`)?.billedCents).toBe(45_050);
    expect(history.find((e) => e.jobNumber === `TEST-VLB-${stamp}`)?.paidCents).toBe(10_050);
  });

  /** Too short to be a question — matching here would return most of the table. */
  it('returns nothing for a single character', async () => {
    expect(await searchVehicles('9')).toEqual([]);
  });

  /**
   * The exact-match lookup had the same blind spot the search was built to fix:
   * it upper-cased the term but compared it to the stored text, so the car
   * entered as `98-D-1234` was invisible to a search for `98D1234`.
   */
  it('matches an exact lookup across punctuation too', async () => {
    const found = await findJobByRegistration(regPlain.toLowerCase());
    expect(found?.customerName).toBe(customer);
  });

  /**
   * The split Lee asked for: once a job is invoiced it belongs on
   * /awaiting-payments, and /jobs is only the cars in the workshop. `open` is
   * deliberately unchanged — it is still the half of the partition that keeps
   * every job visible somewhere.
   */
  it('keeps invoiced work out of the workshop list but inside the open half', async () => {
    const inWorkshop = await listJobs({ scope: 'pre-invoice' });
    const open = await listJobs({ scope: 'open' });

    // jobA is invoiced and paid in full -> settled, so in neither.
    expect(inWorkshop.some((job) => job.id === jobA)).toBe(false);

    // jobB is invoiced with a balance -> invoiced, not workshop, still open.
    expect(inWorkshop.some((job) => job.id === jobB)).toBe(false);
    expect(open.some((job) => job.id === jobB)).toBe(true);

    // jobC's only invoice is voided -> never billed, so it is workshop work.
    expect(inWorkshop.some((job) => job.id === jobC)).toBe(true);
  });

  /**
   * Without this the split would hide a job with no way back: /jobs stops
   * listing invoiced work, so a search there for a customer billed yesterday
   * returns nothing, and nothing reads as "the job is gone".
   */
  it('counts the invoiced matches /jobs can no longer show', async () => {
    expect(await countAwaitingPaymentJobs(customer)).toBe(1);
    expect(await countAwaitingPaymentJobs(`TEST-VLB-${stamp}`)).toBe(1);
    expect(await countAwaitingPaymentJobs(`no-such-customer-${stamp}`)).toBe(0);
  });
});
