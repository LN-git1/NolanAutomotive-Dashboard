import { describe, expect, it } from 'vitest';

import {
  MAKE_NAMES,
  OTHER_OPTION,
  VEHICLE_MAKES,
  isKnownMake,
  isKnownModel,
  modelsForMake,
  vehicleYears,
} from '@/lib/vehicles';

describe('vehicle make and model data', () => {
  it('lists makes alphabetically', () => {
    const sorted = [...MAKE_NAMES].sort((a, b) => a.localeCompare(b, 'en'));
    expect(MAKE_NAMES).toEqual(sorted);
  });

  it('gives every make at least one model', () => {
    for (const make of MAKE_NAMES) {
      expect(modelsForMake(make).length, `${make} has no models`).toBeGreaterThan(0);
    }
  });

  it('has no duplicate models within a make', () => {
    for (const [make, models] of Object.entries(VEHICLE_MAKES)) {
      expect(new Set(models).size, `${make} has duplicate models`).toBe(models.length);
    }
  });

  it('never uses the sentinel value as a real model name', () => {
    for (const models of Object.values(VEHICLE_MAKES)) {
      expect(models).not.toContain(OTHER_OPTION);
    }
    expect(MAKE_NAMES).not.toContain(OTHER_OPTION);
  });

  it('scopes models to their own manufacturer', () => {
    expect(modelsForMake('Ford')).toContain('Fiesta');
    expect(modelsForMake('Ford')).not.toContain('Corolla');
    expect(modelsForMake('Toyota')).toContain('Corolla');
    expect(modelsForMake('Toyota')).not.toContain('Fiesta');
  });

  it('covers the vans a garage actually services, not just cars', () => {
    expect(modelsForMake('Ford')).toContain('Transit');
    expect(modelsForMake('Volkswagen')).toContain('Transporter');
    expect(modelsForMake('Mercedes-Benz')).toContain('Sprinter');
    expect(modelsForMake('Renault')).toContain('Trafic');
  });

  it('returns an empty list rather than throwing for an unknown make', () => {
    expect(modelsForMake('DeLorean')).toEqual([]);
    expect(modelsForMake('')).toEqual([]);
    expect(modelsForMake(null)).toEqual([]);
  });
});

describe('known-value checks', () => {
  /**
   * These decide whether an existing job opens in dropdown or free-text mode.
   * Getting them wrong would silently blank a make that was typed before the
   * lists existed.
   */
  it('recognises listed makes and models', () => {
    expect(isKnownMake('Ford')).toBe(true);
    expect(isKnownModel('Ford', 'Fiesta')).toBe(true);
  });

  it('treats unlisted values as custom', () => {
    expect(isKnownMake('Piaggio')).toBe(false);
    expect(isKnownModel('Ford', 'Model T')).toBe(false);
    expect(isKnownModel('Piaggio', 'Porter')).toBe(false);
  });

  it('handles empty and missing values', () => {
    expect(isKnownMake(null)).toBe(false);
    expect(isKnownMake('')).toBe(false);
    expect(isKnownModel(null, null)).toBe(false);
    expect(isKnownModel('Ford', '')).toBe(false);
  });
});

describe('vehicleYears', () => {
  it('runs from next year down to 1980, newest first', () => {
    const years = vehicleYears(new Date(2026, 7, 13));

    expect(years[0]).toBe(2027);
    expect(years.at(-1)).toBe(1980);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });

  it('includes next year so pre-registered plates can be entered', () => {
    expect(vehicleYears(new Date(2030, 0, 1))).toContain(2031);
  });

  it('has no gaps', () => {
    const years = vehicleYears(new Date(2026, 7, 13));
    expect(years.length).toBe(2027 - 1980 + 1);
  });
});
