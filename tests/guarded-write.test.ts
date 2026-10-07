import { afterEach, describe, expect, it, vi } from 'vitest';

import { guardedWrite } from '@/lib/actions/safe';

describe('guardedWrite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('passes a successful result straight through', async () => {
    await expect(guardedWrite('t', async () => ({ ok: true, jobId: 'j1' }))).resolves.toEqual({
      ok: true,
      jobId: 'j1',
    });
  });

  it('turns a thrown failure into ok:false instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', '');

    const result = await guardedWrite('t', async () => {
      throw new Error('connection terminated');
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/try again/i);
  });

  it('sends the failure webhook and still returns when the webhook itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', 'https://example.test/hook/REPLACE_WITH_REAL_TOKEN');
    vi.stubEnv('MATRIX_DASH_WEBHOOK_TOKEN', 'tok');
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await guardedWrite('addExpense', async () => {
      throw new Error('boom');
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/hook/tok');
    vi.unstubAllGlobals();
  });
});
