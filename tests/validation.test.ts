import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';
import { invoiceDraftSchema, invoiceFinalizeSchema } from '@/lib/validation/invoice';
import { jobInputSchema } from '@/lib/validation/job';
import { settingsInputSchema } from '@/lib/validation/settings';

const VALID_JOB = {
  customerName: 'Séamus Ó Súilleabháin',
  vehicleRegistration: '181-ke-4429',
};

describe('jobInputSchema', () => {
  it('accepts the minimum required fields', () => {
    const result = jobInputSchema.safeParse(VALID_JOB);
    expect(result.success).toBe(true);
  });

  it('normalises the registration to upper case', () => {
    const result = jobInputSchema.parse(VALID_JOB);
    expect(result.vehicleRegistration).toBe('181-KE-4429');
  });

  it('turns blank optional fields into null rather than empty strings', () => {
    const result = jobInputSchema.parse({ ...VALID_JOB, customerPhone: '', notes: '   ' });

    expect(result.customerPhone).toBeNull();
    expect(result.notes).toBeNull();
  });

  it('requires a customer name and a registration', () => {
    expect(jobInputSchema.safeParse({ vehicleRegistration: 'X' }).success).toBe(false);
    expect(jobInputSchema.safeParse({ customerName: 'X' }).success).toBe(false);
  });

  it('rejects an invalid email but allows a blank one', () => {
    expect(jobInputSchema.safeParse({ ...VALID_JOB, customerEmail: 'nope' }).success).toBe(false);
    expect(jobInputSchema.safeParse({ ...VALID_JOB, customerEmail: '' }).success).toBe(true);
  });

  it('rejects an implausible year', () => {
    expect(jobInputSchema.safeParse({ ...VALID_JOB, vehicleYear: '1750' }).success).toBe(false);
    expect(jobInputSchema.safeParse({ ...VALID_JOB, vehicleYear: '2018' }).success).toBe(true);
  });

  it('rejects a non-numeric mileage', () => {
    expect(jobInputSchema.safeParse({ ...VALID_JOB, vehicleMileage: 'lots' }).success).toBe(false);
  });

  it('defaults status and priority', () => {
    const result = jobInputSchema.parse(VALID_JOB);
    expect(result.status).toBe('new');
    expect(result.priority).toBe('medium');
  });

  it('rejects an unknown status', () => {
    expect(jobInputSchema.safeParse({ ...VALID_JOB, status: 'archived' }).success).toBe(false);
  });
});

describe('invoice schemas', () => {
  const base = {
    jobId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    labourHours: '2',
    hourlyRate: '65.00',
    parts: [],
  };

  it('accepts a draft with no parts', () => {
    expect(invoiceDraftSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a non-uuid job id', () => {
    expect(invoiceDraftSchema.safeParse({ ...base, jobId: 'job-1' }).success).toBe(false);
  });

  it('rejects a negative or malformed price', () => {
    const withBadPart = {
      ...base,
      parts: [{ partName: 'Pads', partNumber: 'X', qty: '1', unitPrice: '-5' }],
    };

    expect(invoiceDraftSchema.safeParse(withBadPart).success).toBe(false);
  });

  it('requires a part name on every line', () => {
    const withUnnamedPart = {
      ...base,
      parts: [{ partName: '', partNumber: 'X', qty: '1', unitPrice: '5' }],
    };

    expect(invoiceDraftSchema.safeParse(withUnnamedPart).success).toBe(false);
  });

  it('requires a send channel only when finalising', () => {
    expect(invoiceDraftSchema.safeParse(base).success).toBe(true);
    expect(invoiceFinalizeSchema.safeParse(base).success).toBe(false);
    expect(invoiceFinalizeSchema.safeParse({ ...base, sentVia: 'email' }).success).toBe(true);
    expect(invoiceFinalizeSchema.safeParse({ ...base, sentVia: 'carrier-pigeon' }).success).toBe(
      false,
    );
  });
});

describe('settingsInputSchema', () => {
  it('requires a VAT number when the business is VAT registered', () => {
    const result = settingsInputSchema.safeParse({
      vatRegistered: true,
      vatNumber: '',
      defaultVatRate: '23',
      defaultHourlyRate: '',
    });

    expect(result.success).toBe(false);
  });

  it('allows a blank VAT number when not registered', () => {
    const result = settingsInputSchema.safeParse({
      vatRegistered: false,
      vatNumber: '',
      defaultVatRate: '23',
      defaultHourlyRate: '',
    });

    expect(result.success).toBe(true);
  });

  it('reads the checkbox "on" value as true', () => {
    const result = settingsInputSchema.parse({
      vatRegistered: 'on',
      vatNumber: 'IE1234567FA',
      defaultVatRate: '23',
      defaultHourlyRate: '65',
    });

    expect(result.vatRegistered).toBe(true);
  });
});

describe('toCsv', () => {
  const columns = [
    { key: 'name' as const, header: 'Name' },
    { key: 'note' as const, header: 'Note' },
  ];

  it('quotes every cell and escapes inner quotes', () => {
    const csv = toCsv([{ name: 'A "quoted" name', note: 'plain' }], columns);
    expect(csv).toContain('"A ""quoted"" name"');
  });

  it('keeps embedded commas and newlines inside a single cell', () => {
    const csv = toCsv([{ name: 'Smith, John', note: 'line1\nline2' }], columns);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"line1\nline2"');
  });

  /**
   * These exports contain free text the owner typed. A cell starting with =, +,
   * - or @ is executed as a formula by Excel and Numbers, so it is neutralised.
   */
  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([{ name: '=SUM(A1:A9)', note: '+1' }], columns);

    expect(csv).toContain(`"'=SUM(A1:A9)"`);
    expect(csv).toContain(`"'+1"`);
  });

  it('renders null and undefined as empty cells', () => {
    const csv = toCsv([{ name: null, note: undefined }], columns);
    expect(csv).toContain('"",""');
  });
});
