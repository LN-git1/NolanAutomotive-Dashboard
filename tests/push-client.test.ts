import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rememberTopics, resyncPushSubscription, urlBase64ToUint8Array } from '@/lib/client/push';

/**
 * The browser-side helpers, run against a fake browser. What matters is what a
 * device does when the app opens: restore a subscription the server forgot,
 * but never prompt, never throw, and never do anything for a device that did not
 * switch notifications on.
 */
const SUB_JSON = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'pk', auth: 'ak' } };

function fakeBrowser(options: {
  permission?: NotificationPermission;
  subscription?: boolean;
  status?: { ok: boolean; body: unknown } | 'throw';
  topics?: string[] | 'garbage' | null;
}) {
  const store = new Map<string, string>();
  if (options.topics === 'garbage') store.set('nolan-push-topics', '{not json');
  else if (options.topics) store.set('nolan-push-topics', JSON.stringify(options.topics));

  const fetchMock = vi.fn(async (url: string, ...rest: [RequestInit?]) => {
    void rest;
    if (url === '/api/push/status') {
      if (options.status === 'throw') throw new Error('offline');
      const status = options.status ?? { ok: true, body: { subscribed: false } };
      return { ok: status.ok, json: async () => status.body } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });

  const subscription = { endpoint: SUB_JSON.endpoint, toJSON: () => SUB_JSON };
  const registration = { pushManager: { getSubscription: async () => (options.subscription === false ? null : subscription) } };

  vi.stubGlobal('window', { PushManager: class {}, Notification: class {}, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration) } });
  vi.stubGlobal('Notification', { permission: options.permission ?? 'granted', requestPermission: vi.fn() });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, store };
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.useRealTimers());

describe('resyncPushSubscription: when the app opens', () => {
  it('registers again, with the kinds this device chose, when the server has forgotten it', async () => {
    const { fetchMock } = fakeBrowser({ topics: ['morning', 'system'] });
    await resyncPushSubscription();

    const calls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['/api/push/status', '/api/push/subscribe']);
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ ...SUB_JSON, topics: ['morning', 'system'] });
  });

  it('only refreshes "last seen" when the server already knows the device', async () => {
    const { fetchMock } = fakeBrowser({ topics: ['morning'], status: { ok: true, body: { subscribed: true, topics: ['morning'] } } });
    await resyncPushSubscription();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/push/status']);
  });

  it('does nothing when the server says notifications are not set up yet', async () => {
    const { fetchMock } = fakeBrowser({ topics: ['morning'], status: { ok: true, body: { subscribed: false, unavailable: true } } });
    await resyncPushSubscription();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/push/status']);
  });

  it('does nothing when signed out (the server refuses)', async () => {
    const { fetchMock } = fakeBrowser({ topics: ['morning'], status: { ok: false, body: {} } });
    await resyncPushSubscription();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/push/status']);
  });

  it('does nothing for a device that never chose any kinds', async () => {
    const { fetchMock } = fakeBrowser({ topics: null });
    await resyncPushSubscription();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/push/status']);
  });

  it('does nothing without permission, or without a subscription, and never asks the server', async () => {
    for (const options of [{ permission: 'default' as const }, { permission: 'denied' as const }, { subscription: false }]) {
      const { fetchMock } = fakeBrowser({ topics: ['morning'], ...options });
      await resyncPushSubscription();
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('never throws: not even offline, with corrupt saved data, or in a browser with no push', async () => {
    fakeBrowser({ topics: ['morning'], status: 'throw' });
    await expect(resyncPushSubscription()).resolves.toBeUndefined();
    vi.unstubAllGlobals();

    const { fetchMock } = fakeBrowser({ topics: 'garbage' });
    await expect(resyncPushSubscription()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/push/status']); // corrupt data counts as "never chose"
    vi.unstubAllGlobals();

    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
    await expect(resyncPushSubscription()).resolves.toBeUndefined();
  });
});

describe('rememberTopics', () => {
  it('saves the chosen kinds, and does not throw when storage is blocked', () => {
    const { store } = fakeBrowser({});
    rememberTopics(['morning', 'assigned']);
    expect(JSON.parse(store.get('nolan-push-topics')!)).toEqual(['morning', 'assigned']);

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => rememberTopics(['morning'])).not.toThrow();
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes the URL-safe base64 the server sends, with or without padding', () => {
    // "hello" is aGVsbG8 (unpadded) / aGVsbG8= (padded)
    const expected = [104, 101, 108, 108, 111];
    expect([...urlBase64ToUint8Array('aGVsbG8')]).toEqual(expected);
    expect([...urlBase64ToUint8Array('aGVsbG8=')]).toEqual(expected);
    // URL-safe characters: "??>" is Pz8- in URL-safe base64 (Pz8+ in standard)
    expect([...urlBase64ToUint8Array('Pz8-')]).toEqual([63, 63, 62]);
  });

  it('decodes a real 65-byte VAPID public key to 65 bytes starting with 0x04', () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 4;
    for (let i = 1; i < 65; i += 1) bytes[i] = (i * 7) % 256;
    const b64url = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const decoded = urlBase64ToUint8Array(b64url);
    expect(decoded).toHaveLength(65);
    expect(decoded[0]).toBe(4);
    expect([...decoded]).toEqual([...bytes]);
  });
});
