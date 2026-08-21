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
