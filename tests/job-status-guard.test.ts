import { describe, expect, it, vi } from 'vitest';

/**
 * `changeJobStatus` must refuse `paid`.
 *
 * Earnings sums the `payments` table, so a status flipped straight to `paid`
 * with no payment behind it would claim a job was settled while contributing
 * nothing — the same money-disappears bug that gating Earnings on `status`
 * caused originally. The job page forces `MarkPaidModal` instead, but the guard
 * lives in the action because that is the layer that has to hold against a
 * stale client or a future caller.
 *
 * Tested at the action layer (unlike `applyPayment`, which is tested at the
 * query layer precisely because it has no session check) since the guard IS the
 * action. `requireSession` is stubbed because it reaches for request-scoped
 * cookies that do not exist in the test runner; the refusal returns before any
 * database access, so this needs no TEST_DATABASE_URL.
 */
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () => undefined,
  requireApiSession: async () => null,
  hasValidSession: async () => true,
}));

const JOB_ID = '00000000-0000-4000-8000-000000000001';

describe('changeJobStatus', () => {
  it('refuses to set a job to paid without a recorded payment', async () => {
    const { changeJobStatus } = await import('@/lib/actions/jobs');

    const result = await changeJobStatus(JOB_ID, 'paid');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/record a payment/i);
  });

  it('rejects a status that is not in the enum', async () => {
    const { changeJobStatus } = await import('@/lib/actions/jobs');

    const result = await changeJobStatus(JOB_ID, 'settled');

    expect(result.ok).toBe(false);
  });
});

/**
 * The other half of the same guard, and the one that actually failed in
 * production: `updateJob` spread a full `jobInputSchema` parse into the UPDATE,
 * so the job form's status `<select>` was written on every save. Because that
 * select was uncontrolled, it still held the value the page had been rendered
 * with — so saving an edit after recording a payment silently reverted the job.
 * J-0019 was settled in full and reverted to `completed` exactly that way.
 *
 * A schema-shape assertion rather than a database round trip: the fix IS the
 * absence of the key, and that is checkable without Postgres. `.default('active')`
 * on the original field is why stripping the form input alone was not enough —
 * an absent `status` would have parsed to `'active'` and stamped that over
 * every job on every save.
 */
describe('jobUpdateSchema', () => {
  it('cannot carry a status, so editing a job never rewrites one', async () => {
    const { jobUpdateSchema, jobInputSchema } = await import('@/lib/validation/job');

    const fields = {
      customerName: 'Test Customer',
      vehicleRegistration: '12-D-3456',
      status: 'active',
    };

    const updated = jobUpdateSchema.parse(fields);
    expect(updated).not.toHaveProperty('status');

    // The create path still defaults one, which is what makes omission the fix
    // rather than a tidy-up: reusing this schema for updates would write
    // 'active' over a paid job.
    expect(jobInputSchema.parse(fields)).toHaveProperty('status', 'active');
  });
});
