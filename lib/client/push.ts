/**
 * Browser-side helpers for push notifications. Client only.
 */

/** Turns the key the server hands us into the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function pushIsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** An iPhone or iPad, where push only works once the app is on the Home Screen. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * The service worker registration, or null if there is none within `ms`.
 *
 * The worker is only registered on the live site (see `service-worker.tsx`), so
 * in development `navigator.serviceWorker.ready` would wait forever. A timeout
 * turns that into a plain "not available here" instead of a spinner.
 */
export async function getRegistration(ms = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/**
 * Forget this device on the server and in the browser. Used when signing out,
 * so a phone that is signed out stops receiving the garage's notifications.
 * Never throws and never waits long: signing out must not be held up by it.
 */
export async function unsubscribeThisDevice(timeoutMs = 1500): Promise<void> {
  try {
    if (!pushIsSupported()) return;
    const registration = await getRegistration(800);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Must happen before the session cookie is cleared, or this gets a 401.
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    await subscription.unsubscribe();
  } catch {
    // Best effort only.
  }
}

const TOPICS_KEY = 'nolan-push-topics';

/** Remember which notification kinds this device chose, so a dropped subscription can be restored. */
export function rememberTopics(topics: readonly string[]): void {
  try {
    localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
  } catch {
    // Storage can be blocked (private mode); restoring is a convenience, not a need.
  }
}

function readRememberedTopics(): string[] | null {
  try {
    const raw = localStorage.getItem(TOPICS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Run when the app opens. Safari has no event for "your subscription changed",
 * so this is how a device stays on the list: if it holds a subscription the
 * server has forgotten (cleaned up after a failed delivery, say), register it
 * again with the kinds this device chose. If the server already knows it, this
 * just refreshes its "last seen" time. Never throws, never prompts, and does
 * nothing for a device that never switched notifications on.
 */
export async function resyncPushSubscription(): Promise<void> {
  try {
    if (!pushIsSupported() || Notification.permission !== 'granted') return;

    const registration = await getRegistration(3000);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    const statusResponse = await fetch('/api/push/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!statusResponse.ok) return; // signed out, or the server is struggling: try next time
    const status = (await statusResponse.json()) as { subscribed?: boolean; unavailable?: boolean };
    if (status.subscribed || status.unavailable) return;

    const topics = readRememberedTopics();
    if (!topics) return;

    const json = subscription.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, topics }),
    });
  } catch {
    // Best effort only.
  }
}
