import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claimPush = vi.fn();
const releasePush = vi.fn();
const prunePushClaims = vi.fn();
const sendPush = vi.fn();

vi.mock('@/lib/push/claims', () => ({ claimPush, releasePush, prunePushClaims }));
vi.mock('@/lib/push/send', () => ({ sendPush }));
// The scheduler route also imports the morning-summary query; it needs no database here.
vi.mock('@/lib/push/morning', () => ({ collectMorningFacts: vi.fn() }));

const SENT = { configured: true, attempted: 1, delivered: 1, removed: 0, failed: 0 };
const NOT_CONFIGURED = { configured: false, attempted: 0, delivered: 0, removed: 0, failed: 0 };

beforeEach(() => {
  claimPush.mockReset().mockResolvedValue(true);
  releasePush.mockReset().mockResolvedValue(undefined);
  sendPush.mockReset().mockResolvedValue(SENT);
});

describe('sendSystemAlert: app problems, throttled', () => {
  it('sends to devices with app alerts on, once per kind per time bucket', async () => {
    const { sendSystemAlert } = await import('@/lib/push/system');
    await sendSystemAlert('save-failed', 30);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toBe('system');
    expect(sendPush.mock.calls[0][1].title).toBe('A save failed');
    expect(claimPush.mock.calls[0][0]).toMatch(/^system:save-failed:\d+$/);
  });

  it('stays quiet when the same problem was already announced in this time bucket', async () => {
    claimPush.mockResolvedValue(false);
    const { sendSystemAlert } = await import('@/lib/push/system');
    await sendSystemAlert('page-crashed');
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('uses a different claim for each kind and for each time bucket', async () => {
    vi.useFakeTimers();
    try {
      const { sendSystemAlert } = await import('@/lib/push/system');
      vi.setSystemTime(new Date('2026-01-17T09:00:00Z'));
      await sendSystemAlert('save-failed', 30);
      await sendSystemAlert('page-crashed', 30);
      vi.setSystemTime(new Date('2026-01-17T09:31:00Z'));
      await sendSystemAlert('save-failed', 30);

      const keys = claimPush.mock.calls.map((call) => call[0]);
      expect(new Set(keys).size).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the claim back when notifications are not set up, so a real problem is not swallowed', async () => {
    sendPush.mockResolvedValue(NOT_CONFIGURED);
    const { sendSystemAlert } = await import('@/lib/push/system');
    await sendSystemAlert('database-slow');
    expect(releasePush).toHaveBeenCalledTimes(1);
  });
});

describe('sendBuildResult: once per version and outcome', () => {
  it('tells the devices a version is live and healthy', async () => {
    const { sendBuildResult } = await import('@/lib/push/system');
    const result = await sendBuildResult({ sha: '346800b3d2674bd35b48d196beb64fc86b39cbc9', failures: [] });

    expect(result).toBe('sent');
    expect(claimPush).toHaveBeenCalledWith('build:346800b3d2674bd35b48d196beb64fc86b39cbc9:ok');
    expect(sendPush.mock.calls[0][1].title).toBe('New version is live');
  });

  it('tells them when checks failed, under a different claim from the healthy outcome', async () => {
    const { sendBuildResult } = await import('@/lib/push/system');
    await sendBuildResult({ sha: 'abcdef1', failures: ['login page returned 500'] });

    expect(claimPush).toHaveBeenCalledWith('build:abcdef1:failed');
    expect(sendPush.mock.calls[0][1].title).toBe('New version needs attention');
  });

  it('does not notify twice when the checks are re-run for the same version', async () => {
    claimPush.mockResolvedValue(false);
    const { sendBuildResult } = await import('@/lib/push/system');
    expect(await sendBuildResult({ sha: 'abcdef1', failures: [] })).toBe('duplicate');
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe('notifyBuilder: the message to ZB Automations', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const message = { title: 'New version failed its checks', body: 'login page returned 500', kind: 'error' as const };

  it('posts to the webhook with the token substituted into the URL', async () => {
    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', 'https://hooks.example.com/in/REPLACE_WITH_REAL_TOKEN');
    vi.stubEnv('MATRIX_DASH_WEBHOOK_TOKEN', 'tok123');
    const { notifyBuilder } = await import('@/lib/push/system');
    await notifyBuilder(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.example.com/in/tok123');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'notify', ...message });
  });

  it('does nothing when the webhook is not configured or still holds a placeholder', async () => {
    const { notifyBuilder } = await import('@/lib/push/system');

    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', '');
    vi.stubEnv('MATRIX_DASH_WEBHOOK_TOKEN', '');
    await notifyBuilder(message);

    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', 'https://hooks.example.com/in/x');
    vi.stubEnv('MATRIX_DASH_WEBHOOK_TOKEN', 'SET_TOKEN_FROM_MATRIX_DASH_API_TOKENS');
    await notifyBuilder(message);

    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', 'https://hooks.example.com/REPLACE_WITH_REAL_OTHER');
    vi.stubEnv('MATRIX_DASH_WEBHOOK_TOKEN', 'tok');
    await notifyBuilder(message);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws, even when the webhook is down', async () => {
    vi.stubEnv('MATRIX_DASH_WEBHOOK_URL', 'https://hooks.example.com/in/REPLACE_WITH_REAL_TOKEN');
    vi.stubEnv('MATRIX_DASH_WEBHOOK_TOKEN', 'tok');
    fetchMock.mockRejectedValue(new Error('network down'));
    const { notifyBuilder } = await import('@/lib/push/system');
    await expect(notifyBuilder(message)).resolves.toBeUndefined();
  });
});

describe('POST /api/push/scheduled?job=deploy', { timeout: 20_000 }, () => {
  const sendBuildResult = vi.fn();
  const notifyBuilder = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DIGEST_SECRET', 's3cret');
    sendBuildResult.mockReset().mockResolvedValue('sent');
    notifyBuilder.mockReset().mockResolvedValue(undefined);
    vi.doMock('@/lib/push/system', () => ({ sendBuildResult, notifyBuilder }));
  });
  afterEach(() => vi.unstubAllEnvs());

  async function post(body: unknown, secret: string | null = 's3cret', query = '?job=deploy') {
    const { POST } = await import('@/app/api/push/scheduled/route');
    return POST(
      new Request(`https://x.test/api/push/scheduled${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  }

  it('answers 404 without the secret', async () => {
    expect((await post({ sha: 'abcdef1', failures: [] }, null)).status).toBe(404);
    expect((await post({ sha: 'abcdef1', failures: [] }, 'wrong')).status).toBe(404);
    expect(sendBuildResult).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a commit id and a list of short messages', async () => {
    expect((await post({ sha: 'not-a-sha', failures: [] })).status).toBe(400);
    expect((await post({ sha: 'abcdef1', failures: 'none' })).status).toBe(400);
    expect((await post({ sha: 'abcdef1', failures: ['x'.repeat(201)] })).status).toBe(400);
    expect((await post({ sha: 'abcdef1', failures: Array(21).fill('x') })).status).toBe(400);
    expect((await post('nope')).status).toBe(400);
    expect(sendBuildResult).not.toHaveBeenCalled();
  });

  it('a healthy version notifies the devices and does not bother the builder', async () => {
    const response = await post({ sha: 'abcdef1', failures: [] });
    expect(response.status).toBe(200);
    expect(sendBuildResult).toHaveBeenCalledWith({ sha: 'abcdef1', failures: [] });
    expect(notifyBuilder).not.toHaveBeenCalled();
  });

  it('a failing version notifies the devices and tells the builder what failed', async () => {
    await post({ sha: 'abcdef1234', failures: ['login page returned 500', 'manifest returned 404'] });

    expect(notifyBuilder).toHaveBeenCalledTimes(1);
    const message = notifyBuilder.mock.calls[0][0];
    expect(message.kind).toBe('error');
    expect(message.title).toContain('abcdef1');
    expect(message.body).toContain('login page returned 500; manifest returned 404');
  });

  it('a failed check still reaches the builder when the notification tables are not ready', async () => {
    sendBuildResult.mockRejectedValue(new Error('relation "push_claims" does not exist'));

    const response = await post({ sha: 'abcdef1', failures: ['login page returned 500'] });

    expect(response.status).toBe(503);
    expect(notifyBuilder).toHaveBeenCalledTimes(1);
  });

  it('a healthy version with the tables not ready is reported as unavailable and bothers nobody', async () => {
    sendBuildResult.mockRejectedValue(new Error('relation "push_claims" does not exist'));

    const response = await post({ sha: 'abcdef1', failures: [] });

    expect(response.status).toBe(503);
    expect(notifyBuilder).not.toHaveBeenCalled();
  });

  it('a re-run for a version already reported does not message the builder again', async () => {
    sendBuildResult.mockResolvedValue('duplicate');
    await post({ sha: 'abcdef1', failures: ['login page returned 500'] });
    expect(notifyBuilder).not.toHaveBeenCalled();
  });

  it('dryRun shows the message and sends nothing', async () => {
    const body = await (await post({ sha: 'abcdef1', failures: [] }, 's3cret', '?job=deploy&dryRun=1')).json();
    expect(body.dryRun).toBe(true);
    expect(body.payload.title).toBe('New version is live');
    expect(sendBuildResult).not.toHaveBeenCalled();
  });
});

describe('guardedWrite raises an app alert without changing what it returns', { timeout: 20_000 }, () => {
  const alertAfterResponse = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    alertAfterResponse.mockReset();
    vi.doMock('@/lib/push/alert', () => ({ alertAfterResponse }));
    vi.doMock('@/lib/errors/log', () => ({ recordError: async () => undefined }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('a failed write still returns the same friendly error, and raises a "save failed" alert', async () => {
    const { guardedWrite } = await import('@/lib/actions/safe');
    const result = await guardedWrite('testWrite', async () => {
      throw new Error('connection reset');
    });

    expect(result).toEqual({ ok: false, error: 'Could not save that just now — please try again.' });
    expect(alertAfterResponse).toHaveBeenCalledWith('save-failed');
  });

  it('a successful write raises nothing', async () => {
    const { guardedWrite } = await import('@/lib/actions/safe');
    const result = await guardedWrite('testWrite', async () => ({ ok: true }));

    expect(result).toEqual({ ok: true });
    expect(alertAfterResponse).not.toHaveBeenCalled();
  });
});
