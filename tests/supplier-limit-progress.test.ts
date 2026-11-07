import { describe, expect, it } from 'vitest';

import { limitProgress } from '@/lib/supplier-limit-progress';

describe('limitProgress', () => {
  it('has no bar when there is no usable limit', () => {
    expect(limitProgress(5000, null)).toBeNull();
    expect(limitProgress(5000, 0)).toBeNull();
    expect(limitProgress(5000, -100)).toBeNull();
  });

  it('is green below 80%', () => {
    expect(limitProgress(0, 100000)).toMatchObject({ percent: 0, tone: 'ok', overByCents: 0 });
    expect(limitProgress(79999, 100000)).toMatchObject({ tone: 'ok' });
  });

  it('turns orange from exactly 80%, the same line as the phone alert', () => {
    expect(limitProgress(80000, 100000)).toMatchObject({ percent: 80, tone: 'warn', fillPercent: 80 });
    expect(limitProgress(99999, 100000)).toMatchObject({ tone: 'warn' });
  });

  it('turns red at the limit, and going over is shown rather than blocked', () => {
    expect(limitProgress(100000, 100000)).toMatchObject({ percent: 100, tone: 'over', overByCents: 0 });
    // The percentage keeps counting past 100; only the drawn bar stops at full.
    expect(limitProgress(112000, 100000)).toMatchObject({
      percent: 112,
      fillPercent: 100,
      tone: 'over',
      overByCents: 12000,
    });
  });

  it('treats a credit as an empty bar', () => {
    expect(limitProgress(-25000, 100000)).toMatchObject({ percent: 0, fillPercent: 0, tone: 'ok' });
  });
});
