import { describe, expect, it } from 'vitest';

import { renderDigest, renderDigestDbDown } from '@/lib/digest/render';
import type { DigestData } from '@/lib/digest/types';
import { alignedWindow } from '@/lib/digest/window';

const end = new Date('2026-10-07T15:00:00Z');
const start = new Date('2026-10-07T12:00:00Z');

function base(overrides: Partial<DigestData> = {}): DigestData {
  return {
    windowStart: start,
    windowEnd: end,
    dbMs: 40,
    errors: [],
    jobsCreated: [],
    jobsUpdated: [],
    jobsDeleted: [],
    invoicesIssued: [],
    invoicesSent: [],
    invoicesVoided: [],
    payments: [],
    expenses: [],
    supplierEntries: [],
    attachments: [],
    timeOff: [],
    snapshot: {
      jobsByStatus: { active: 3, completed: 1, invoiced: 2, paid: 10 },
      overdueJobs: 1,
      dueSoon: [{ jobNumber: 'J-0050', status: 'active', dueDate: '2026-10-08' }],
      outstandingCount: 2,
      outstandingCents: 123450,
      oldestUnpaid: { invoiceNumber: 'INV-2026-0007', issueDate: '2026-09-20' },
      collectedTodayCents: 5000,
      collectedMonthCents: 99000,
      totalJobs: 16,
      totalInvoices: 12,
      totalPayments: 11,
      totalSuppliers: 3,
      dbBytes: 12_000_000,
      lastActivityAt: end,
    },
    ...overrides,
  };
}

describe('alignedWindow', () => {
  it('ends on the latest 3-hour UTC boundary, however late the scheduler runs', () => {
    for (const run of ['2026-10-07T15:00:05Z', '2026-10-07T15:14:59Z', '2026-10-07T17:59:59Z']) {
      const w = alignedWindow(new Date(run));
      expect(w.end.toISOString()).toBe('2026-10-07T15:00:00.000Z');
      expect(w.start.toISOString()).toBe('2026-10-07T12:00:00.000Z');
    }
  });

  it('produces contiguous windows with no gap or overlap', () => {
    const a = alignedWindow(new Date('2026-10-07T15:03:00Z'));
    const b = alignedWindow(new Date('2026-10-07T18:11:00Z'));
    expect(b.start.getTime()).toBe(a.end.getTime());
  });
});

describe('renderDigest', () => {
  it('reports a healthy quiet window', () => {
    const out = renderDigest(base());
    expect(out.subject).toContain('no errors');
    expect(out.html).toContain('All healthy');
    expect(out.html).toContain('Quiet window');
    expect(out.text).toContain('ERRORS (0)');
  });

  it('surfaces errors in the subject, banner and list, and escapes their text', () => {
    const out = renderDigest(
      base({
        errors: [
          { at: start, source: 'action', label: 'reverseExpense', message: '<script>alert(1)</script> boom', code: '08006' },
        ],
      }),
    );
    expect(out.subject).toContain('⚠ 1 error');
    expect(out.html).toContain('1 error in this window');
    expect(out.html).toContain('reverseExpense');
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('lists activity with amounts and totals', () => {
    const out = renderDigest(
      base({
        jobsCreated: [{ jobNumber: 'J-0051', status: 'active', priority: 'medium', dueDate: '2026-10-09', at: start }],
        payments: [{ invoiceNumber: 'INV-2026-0010', jobNumber: 'J-0044', amountCents: 25000, at: end }],
      }),
    );
    expect(out.html).toContain('J-0051');
    expect(out.html).toContain('INV-2026-0010');
    expect(out.subject).toContain('1 jobs added');
    expect(out.subject).toContain('€250.00 in');
    expect(out.html).not.toContain('Quiet window');
  });

  it('flags a slow database even with no errors', () => {
    expect(renderDigest(base({ dbMs: 4200 })).html).toContain('database was slow');
  });

  it('renders a database-unreachable fallback', () => {
    const out = renderDigestDbDown({ windowStart: start, windowEnd: end }, 'connection terminated');
    expect(out.subject).toContain('database unreachable');
    expect(out.html).toContain('connection terminated');
  });
});
