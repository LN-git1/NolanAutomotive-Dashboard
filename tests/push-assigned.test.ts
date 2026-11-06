import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAfterResponse } from '@/lib/push/after';
import { newlyAdded } from '@/lib/push/diff';

describe('who was newly added', () => {
  it('is only the people who were not on the job before', () => {
    expect(newlyAdded(['a', 'b'], ['b', 'c'])).toEqual(['c']);
    expect(newlyAdded([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('is empty when nothing changed, or when people were only removed', () => {
    expect(newlyAdded(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(newlyAdded(['a', 'b'], ['a'])).toEqual([]);
    expect(newlyAdded(['a'], [])).toEqual([]);
  });

  it('counts a repeated id once', () => {
    expect(newlyAdded([], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('runAfterResponse: a notification can never break a save', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('runs the task', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    runAfterResponse(task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });

  it('swallows a task that throws', async () => {
    const task = vi.fn().mockRejectedValue(new Error('push service down'));
    expect(() => runAfterResponse(task)).not.toThrow();
    await vi.waitFor(() => expect(task).toHaveBeenCalled());
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it('swallows a task whose lazy import fails (push code missing or broken)', async () => {
    const missing = ['@/lib/push', 'this-file-does-not-exist'].join('/');
    expect(() =>
      runAfterResponse(async () => {
        await import(/* @vite-ignore */ missing);
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it('swallows a task that throws synchronously', async () => {
    expect(() =>
      runAfterResponse(() => {
        throw new Error('boom');
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });
});

describe('notifyAssigned', () => {
  const sendPush = vi.fn();
  let jobRows: { jobNumber: string }[];
  let personRows: { name: string }[];

  beforeEach(() => {
    vi.resetModules();
    sendPush.mockReset().mockResolvedValue({ configured: true, attempted: 1, delivered: 1, removed: 0, failed: 0 });
    jobRows = [{ jobNumber: 'NA-0042' }];
    personRows = [{ name: 'Mick' }];

    vi.doMock('@/lib/push/send', () => ({ sendPush }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: () => ({
          from: (table: { _?: unknown }) => {
            const rows = () => (String(Object.keys(table ?? {})).includes('jobNumber') ? jobRows : personRows);
            return { where: () => ({ limit: async () => rows(), then: (r: (v: unknown) => void) => r(rows()) }) };
          },
        }),
      },
    }));
  });

  it('sends one notification naming the job and the person', async () => {
    const { notifyAssigned } = await import('@/lib/push/assigned');
    await notifyAssigned('job-1', ['p1']);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toBe('assigned');
    expect(sendPush.mock.calls[0][1].body).toBe('NA-0042 was assigned to Mick.');
  });

  it('names several people in plain English', async () => {
    personRows = [{ name: 'Mick' }, { name: 'Sean' }, { name: 'Pat' }];
    const { notifyAssigned } = await import('@/lib/push/assigned');
    await notifyAssigned('job-1', ['p1', 'p2', 'p3']);

    expect(sendPush.mock.calls[0][1].body).toBe('NA-0042 was assigned to Mick, Sean and Pat.');
  });

  it('sends nothing when nobody was added', async () => {
    const { notifyAssigned } = await import('@/lib/push/assigned');
    await notifyAssigned('job-1', []);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('sends nothing when the job or the people cannot be found', async () => {
    const { notifyAssigned } = await import('@/lib/push/assigned');

    jobRows = [];
    await notifyAssigned('job-1', ['p1']);

    jobRows = [{ jobNumber: 'NA-0042' }];
    personRows = [];
    await notifyAssigned('job-1', ['p1']);

    expect(sendPush).not.toHaveBeenCalled();
  });
});
