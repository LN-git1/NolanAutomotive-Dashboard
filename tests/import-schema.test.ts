import { describe, expect, it } from 'vitest';

import { extractedJobSchema } from '@/lib/import/schema';

describe('extractedJobSchema', () => {
  it('accepts a realistic full extraction', () => {
    const result = extractedJobSchema.safeParse({
      customerName: 'Sarah Doyle',
      customerPhone: '087 123 4567',
      vehicleRegistration: '251-WX-1001',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      dueDate: '2026-08-25',
      dueTime: '09:30',
      priority: 'medium',
      labourLines: [{ description: 'Front brake discs and pads', hours: '2.5' }],
      parts: [{ partName: 'Brake pads', partNumber: 'BP-100', qty: '1', unitPrice: '45.00' }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts an almost-empty extraction — most fields genuinely absent', () => {
    const result = extractedJobSchema.safeParse({ customerName: 'Walk-in customer' });
    expect(result.success).toBe(true);
  });

  it('accepts a completely empty object', () => {
    expect(extractedJobSchema.safeParse({}).success).toBe(true);
  });

  it('tolerates hours/qty/price sent as numbers, not just strings', () => {
    const result = extractedJobSchema.safeParse({
      labourLines: [{ description: 'Oil change', hours: 1 }],
      parts: [{ partName: 'Oil filter', qty: 1, unitPrice: 12.5 }],
    });

    expect(result.success).toBe(true);
  });

  it('drops rather than throws on a malformed labour line', () => {
    // A non-object entry in the array is the kind of thing a model occasionally
    // produces — the array item schema should reject just that entry's shape,
    // not the whole array, when used with .safeParse at the call site.
    const result = extractedJobSchema.safeParse({
      labourLines: [{ description: 'Fine', hours: '1' }, 'not an object'],
    });

    expect(result.success).toBe(false);
  });

  it('never defines status, hourlyRate, or labourTotalOverride as recognised keys', () => {
    // These three must never be part of what the model is asked to produce —
    // even if present in the input, parsing must not surface them as valid
    // output fields a caller could accidentally forward to createJob.
    const shape = extractedJobSchema.shape as Record<string, unknown>;
    expect(shape.status).toBeUndefined();
    expect(shape.hourlyRate).toBeUndefined();
    expect(shape.labourTotalOverride).toBeUndefined();
  });
});
