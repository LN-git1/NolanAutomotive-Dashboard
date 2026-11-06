import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real createJob / updateJob against a real Postgres: the push hook sits in
 * a live write path, so what must be shown is that (a) saving still works, (b)
 * only newly added people trigger a notification, and (c) a broken notification
 * cannot fail the save. Skipped without TEST_DATABASE_URL, like the other
 * database tests.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const notifyAssigned = vi.fn();

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () => undefined,
  requireApiSession: async () => null,
  hasValidSession: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@/lib/push/assigned', () => ({ notifyAssigned }));

function jobForm(extra: Record<string, string | string[]> = {}) {
  const form = new FormData();
  form.set('customerName', 'Push Test Customer');
  form.set('vehicleRegistration', '99-D-9999');
  form.set('assigneesPresent', '1');
  for (const [key, value] of Object.entries(extra)) {
    for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  }
  return form;
}

describe.skipIf(!TEST_DATABASE_URL)('job assignment notifications (real database)', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let s: typeof import('@/lib/db/schema');
  let actions: typeof import('@/lib/actions/jobs');

  const mick = randomUUID();
  const sean = randomUUID();
  const created: string[] = [];

  beforeAll(async () => {
    ({ db } = await import('@/lib/db'));
    s = await import('@/lib/db/schema');
    actions = await import('@/lib/actions/jobs');
    await db.insert(s.assignees).values([
      { id: mick, name: 'Push Test Mick' },
      { id: sean, name: 'Push Test Sean' },
    ]);
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    if (created.length) await db.delete(s.jobs).where(inArray(s.jobs.id, created));
    await db.delete(s.assignees).where(inArray(s.assignees.id, [mick, sean]));
  });

  beforeEach(() => {
    notifyAssigned.mockReset().mockResolvedValue(undefined);
  });

  async function waitForNotifications(count: number) {
    await vi.waitFor(() => expect(notifyAssigned).toHaveBeenCalledTimes(count), { timeout: 3000 });
  }

  it('a new job with people ticked notifies about all of them', async () => {
    const result = await actions.createJob(jobForm({ assigneeIds: [mick, sean] }));
    expect(result.ok).toBe(true);
    created.push(result.jobId!);

    await waitForNotifications(1);
    expect(notifyAssigned.mock.calls[0][0]).toBe(result.jobId);
    expect([...notifyAssigned.mock.calls[0][1]].sort()).toEqual([mick, sean].sort());
  });

  it('a new job with nobody ticked notifies nobody', async () => {
    const result = await actions.createJob(jobForm({}));
    expect(result.ok).toBe(true);
    created.push(result.jobId!);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(notifyAssigned).not.toHaveBeenCalled();
  });

  it('editing a job notifies only the person newly added', async () => {
    const result = await actions.createJob(jobForm({ assigneeIds: [mick] }));
    created.push(result.jobId!);
    await waitForNotifications(1);
    notifyAssigned.mockClear();

    const edit = await actions.updateJob(result.jobId!, jobForm({ assigneeIds: [mick, sean] }));
    expect(edit.ok).toBe(true);

    await waitForNotifications(1);
    expect(notifyAssigned).toHaveBeenCalledWith(result.jobId, [sean]);

    // ...and the assignees really were saved.
    const rows = await db.select().from(s.jobAssignees).where(eq(s.jobAssignees.jobId, result.jobId!));
    expect(rows.map((r) => r.assigneeId).sort()).toEqual([mick, sean].sort());
  });

  it('saving again without changing who is on the job sends nothing', async () => {
    const result = await actions.createJob(jobForm({ assigneeIds: [mick] }));
    created.push(result.jobId!);
    await waitForNotifications(1);
    notifyAssigned.mockClear();

    const edit = await actions.updateJob(result.jobId!, jobForm({ assigneeIds: [mick] }));
    expect(edit.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(notifyAssigned).not.toHaveBeenCalled();
  });

  it('removing someone sends nothing', async () => {
    const result = await actions.createJob(jobForm({ assigneeIds: [mick, sean] }));
    created.push(result.jobId!);
    await waitForNotifications(1);
    notifyAssigned.mockClear();

    const edit = await actions.updateJob(result.jobId!, jobForm({ assigneeIds: [mick] }));
    expect(edit.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(notifyAssigned).not.toHaveBeenCalled();
  });

  it('an edit that does not carry the people field leaves the assignees and notifications alone', async () => {
    const result = await actions.createJob(jobForm({ assigneeIds: [mick] }));
    created.push(result.jobId!);
    await waitForNotifications(1);
    notifyAssigned.mockClear();

    const form = jobForm({});
    form.delete('assigneesPresent');
    const edit = await actions.updateJob(result.jobId!, form);
    expect(edit.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(notifyAssigned).not.toHaveBeenCalled();
    const rows = await db.select().from(s.jobAssignees).where(eq(s.jobAssignees.jobId, result.jobId!));
    expect(rows.map((r) => r.assigneeId)).toEqual([mick]);
  });

  it('a failing notification never fails the save', async () => {
    notifyAssigned.mockRejectedValue(new Error('push service exploded'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await actions.createJob(jobForm({ assigneeIds: [mick] }));
    expect(result.ok).toBe(true);
    created.push(result.jobId!);

    const edit = await actions.updateJob(result.jobId!, jobForm({ assigneeIds: [mick, sean] }));
    expect(edit.ok).toBe(true);

    await waitForNotifications(2);
    const saved = await db.select().from(s.jobAssignees).where(eq(s.jobAssignees.jobId, result.jobId!));
    expect(saved).toHaveLength(2);
  });
});
