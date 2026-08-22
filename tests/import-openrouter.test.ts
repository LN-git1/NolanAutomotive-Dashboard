import { afterEach, describe, expect, it, vi } from 'vitest';

import { callOpenRouter } from '@/lib/import/openrouter';

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('callOpenRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts to the OpenRouter chat completions endpoint with the given messages', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const fetchMock = mockFetchOnce({
      ok: true,
      body: { choices: [{ message: { content: '{"customerName":"Sarah Doyle"}' } }] },
    });

    const result = await callOpenRouter('markdown', [{ role: 'user', content: 'hello' }]);

    expect(result).toBe('{"customerName":"Sarah Doyle"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.model).toBe('google/gemini-2.5-flash');
    expect(body.temperature).toBe(0.1);
  });

  it('throws a clear error on a non-2xx response', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    mockFetchOnce({ ok: false, status: 429, body: { error: { message: 'rate limited upstream' } } });

    await expect(callOpenRouter('markdown', [])).rejects.toThrow(/rate limited upstream/);
  });

  it('throws a clear error when the response has no message content', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    mockFetchOnce({ ok: true, body: { choices: [] } });

    await expect(callOpenRouter('markdown', [])).rejects.toThrow();
  });

  it('throws immediately, without calling fetch, if OPENROUTER_API_KEY is not set', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetchMock = mockFetchOnce({ ok: true, body: {} });

    await expect(callOpenRouter('markdown', [])).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
