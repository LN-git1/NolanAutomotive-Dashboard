import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('modals after the bottom-sheet change', () => {
  it('recording a payment still cannot be swiped or tapped away', () => {
    // It is the one modal that must not be escaped: skipping it would let a job
    // be marked paid without the money being recorded. See mark-paid-modal.tsx.
    expect(read('components/payments/mark-paid-modal.tsx')).toMatch(/dismissible=\{false\}/);
  });

  it('the other modals can be dismissed (default)', () => {
    for (const file of [
      'components/settings/time-off.tsx',
      'components/suppliers/supplier-account-actions.tsx',
      'components/jobs/job-row-actions.tsx',
    ]) {
      const source = read(file);
      expect(source).toContain('ResponsiveModal');
      expect(source).not.toMatch(/dismissible=\{false\}/);
    }
  });

  it('the shared modal keeps the old centred pop-up for wide screens and a sheet for phones', () => {
    const source = read('components/ui/responsive-modal.tsx');
    expect(source).toContain('max-width: 639px');
    expect(source).toContain('role="dialog"');
    expect(source).toContain("from 'vaul'");
  });
});
