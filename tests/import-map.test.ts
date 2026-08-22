import { describe, expect, it } from 'vitest';

import { isPrefillEmpty, mapExtractedToPrefill } from '@/lib/import/map';

describe('mapExtractedToPrefill', () => {
  it('carries through simple string fields unchanged', () => {
    const prefill = mapExtractedToPrefill({
      customerName: 'Sarah Doyle',
      customerPhone: '087 123 4567',
      labourLines: [],
      parts: [],
    });

    expect(prefill.customerName).toBe('Sarah Doyle');
    expect(prefill.customerPhone).toBe('087 123 4567');
  });

  it('normalises vehicle make/model via lib/vehicles', () => {
    const prefill = mapExtractedToPrefill({
      vehicleMake: 'toyota',
      vehicleModel: 'corolla',
      labourLines: [],
      parts: [],
    });

    expect(prefill.vehicleMake).toBe('Toyota');
    expect(prefill.vehicleModel).toBe('Corolla');
  });

  it('drops a labour line with no description', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [{ description: '', hours: '2' }, { description: 'Oil change', hours: '1' }],
      parts: [],
    });

    expect(prefill.labourLines).toHaveLength(1);
    expect(prefill.labourLines[0]!.description).toBe('Oil change');
  });

  it('drops a part with no name', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [],
      parts: [
        { partName: '', qty: '1', unitPrice: '10' },
        { partName: 'Oil filter', qty: '1', unitPrice: '12.50' },
      ],
    });

    expect(prefill.parts).toHaveLength(1);
    expect(prefill.parts[0]!.partName).toBe('Oil filter');
  });

  it('normalises hours/qty/unitPrice text into plain decimal strings', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [{ description: 'Oil change', hours: '2.5 hours' }],
      parts: [{ partName: 'Filter', qty: '1x', unitPrice: '€45.00' }],
    });

    expect(prefill.labourLines[0]!.hours).toBe('2.5');
    expect(prefill.parts[0]!.qty).toBe('1');
    expect(prefill.parts[0]!.unitPrice).toBe('45.00');
  });

  it('normalises comma-thousands numbers correctly', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [{ description: 'Install gearbox', hours: '1,500.50' }],
      parts: [
        { partName: 'Transmission', qty: '1', unitPrice: '€1,500.00' },
        { partName: 'Bolt set', qty: '1,234', unitPrice: '15.50' },
      ],
    });

    expect(prefill.labourLines[0]!.hours).toBe('1500.50');
    expect(prefill.parts[0]!.unitPrice).toBe('1500.00');
    expect(prefill.parts[1]!.qty).toBe('1234');
  });

  it('drops an out-of-range or non-numeric year rather than passing it through', () => {
    expect(mapExtractedToPrefill({ vehicleYear: '1850', labourLines: [], parts: [] }).vehicleYear).toBeUndefined();
    expect(mapExtractedToPrefill({ vehicleYear: 'not a year', labourLines: [], parts: [] }).vehicleYear).toBeUndefined();
    expect(mapExtractedToPrefill({ vehicleYear: '2024', labourLines: [], parts: [] }).vehicleYear).toBe(2024);
  });

  it('drops an invalid priority rather than passing it through', () => {
    expect(mapExtractedToPrefill({ priority: 'urgent', labourLines: [], parts: [] }).priority).toBeUndefined();
    expect(mapExtractedToPrefill({ priority: 'high', labourLines: [], parts: [] }).priority).toBe('high');
  });

  it('drops an invalid date/time rather than passing it through', () => {
    expect(mapExtractedToPrefill({ dueDate: 'next tuesday', labourLines: [], parts: [] }).dueDate).toBeUndefined();
    expect(mapExtractedToPrefill({ dueDate: '2026-08-25', labourLines: [], parts: [] }).dueDate).toBe('2026-08-25');
    expect(mapExtractedToPrefill({ dueTime: '9:30am', labourLines: [], parts: [] }).dueTime).toBeUndefined();
    expect(mapExtractedToPrefill({ dueTime: '09:30', labourLines: [], parts: [] }).dueTime).toBe('09:30');
  });

  it('caps labourLines and parts at 50 entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ description: `Line ${i}`, hours: '1' }));
    const prefill = mapExtractedToPrefill({ labourLines: many, parts: [] });
    expect(prefill.labourLines).toHaveLength(50);
  });
});

describe('isPrefillEmpty', () => {
  it('is true for a genuinely empty extraction', () => {
    expect(isPrefillEmpty(mapExtractedToPrefill({ labourLines: [], parts: [] }))).toBe(true);
  });

  it('is false when even one field is populated', () => {
    expect(
      isPrefillEmpty(mapExtractedToPrefill({ customerName: 'Sarah Doyle', labourLines: [], parts: [] })),
    ).toBe(false);
  });

  it('is false when only a labour line is populated', () => {
    expect(
      isPrefillEmpty(
        mapExtractedToPrefill({ labourLines: [{ description: 'Oil change', hours: '1' }], parts: [] }),
      ),
    ).toBe(false);
  });
});
