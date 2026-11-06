import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claimPush = vi.fn();
const releasePush = vi.fn();
const sendPush = vi.fn();
const collectMorningFacts = vi.fn();

vi.mock('@/lib/push/claims', () => ({ claimPush, releasePush }));
vi.mock('@/lib/push/send', () => ({ sendPush }));
vi.mock('@/lib/push/morning', () => ({ collectMorningFacts }));

const SECRET = 'test-secret';

function call(query: string, secret: string | null = SECRET) {
  return import('@/app/api/push/scheduled/route').then(({ POST }) =>
    POST(
      new Request(`https://x.test/api/push/scheduled${query}`, {
        method: 'POST',
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      }),
    ),
  );
}

beforeEach(() => {
  vi.stubEnv('DIGEST_SECRET', SECRET);
  vi.useFakeTimers();
  // 09:30 Dublin on a Saturday in January: inside the window.
  vi.setSystemTime(new Date('2026-01-17T09:30:00Z'));
  claimPush.mockReset().mockResolvedValue(true);
  releasePush.mockReset().mockResolvedValue(undefined);
  sendPush.mockReset().mockResolvedValue({ configured: true, attempted: 2, delivered: 2, removed: 0, failed: 0 });
  collectMorningFacts.mockReset().mockResolvedValue({ bookedToday: 0, overdue: 0, jobNumbers: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('POST /api/push/scheduled', () => {
  it('answers 404 to anything without the right secret, so the path is not confirmed to exist', async () => {
    expect((await call('?job=morning', null)).status).toBe(404);
    expect((await call('?job=morning', 'wrong')).status).toBe(404);

    vi.stubEnv('DIGEST_SECRET', '');
    expect((await call('?job=morning', '')).status).toBe(404);

    expect(claimPush).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('rejects an unknown job', async () => {
    expect((await call('?job=other')).status).toBe(400);
    expect((await call('')).status).toBe(400);
  });

  it('sends the summary on a day with nothing booked, saying so', async () => {
    const response = await call('?job=morning');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(claimPush).toHaveBeenCalledWith('morning:2026-01-17');
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toBe('morning');
    expect(sendPush.mock.calls[0][1].body).toBe('Nothing booked in today.');
    expect(body.sent).toBe(true);
  });

  it('does nothing outside the 9am window', async () => {
    vi.setSystemTime(new Date('2026-01-17T07:00:00Z'));
    const body = await (await call('?job=morning')).json();

    expect(body.sent).toBe(false);
    expect(body.skipped).toMatch(/window/);
    expect(claimPush).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('sends only once a day: a second run finds the day already claimed', async () => {
    claimPush.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await call('?job=morning');
    const second = await (await call('?job=morning')).json();

    expect(second.skipped).toMatch(/already sent/);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('gives the claim back when notifications are not set up yet, so a later run can still send', async () => {
    sendPush.mockResolvedValue({ configured: false, attempted: 0, delivered: 0, removed: 0, failed: 0 });
    await call('?job=morning');
    expect(releasePush).toHaveBeenCalledWith('morning:2026-01-17');
  });

  it('gives the claim back when every delivery failed', async () => {
    sendPush.mockResolvedValue({ configured: true, attempted: 2, delivered: 0, removed: 0, failed: 2 });
    await call('?job=morning');
    expect(releasePush).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim when nobody has switched notifications on (nothing to retry)', async () => {
    sendPush.mockResolvedValue({ configured: true, attempted: 0, delivered: 0, removed: 0, failed: 0 });
    await call('?job=morning');
    expect(releasePush).not.toHaveBeenCalled();
  });

  it('dryRun shows the message without claiming or sending, at any hour', async () => {
    vi.setSystemTime(new Date('2026-01-17T03:00:00Z'));
    collectMorningFacts.mockResolvedValue({ bookedToday: 2, overdue: 1, jobNumbers: ['J1', 'J2'] });

    const body = await (await call('?job=morning&dryRun=1')).json();

    expect(body.dryRun).toBe(true);
    expect(body.payload.body).toBe('2 jobs booked in today: J1, J2. 1 job is overdue.');
    expect(claimPush).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });
});
