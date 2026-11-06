'use client';

import { useCallback, useEffect, useState } from 'react';

import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import {
  getRegistration,
  isInstalledApp,
  isIosDevice,
  pushIsSupported,
  urlBase64ToUint8Array,
} from '@/lib/client/push';
import { PUSH_TOPICS, PUSH_TOPIC_INFO, type PushTopic } from '@/lib/push/topics';

type State =
  | { kind: 'loading' }
  | { kind: 'needs-install' }
  | { kind: 'unsupported' }
  | { kind: 'unavailable' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on'; topics: PushTopic[] };

async function postJson(url: string, body: unknown, method = 'POST') {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Switch notifications on or off for THIS device, and choose which kinds it gets.
 *
 * Built only from the app's existing card, button, alert and checkbox styles.
 * It asks the server nothing while the Settings page renders: everything is
 * looked up after the page has loaded, so if notifications are not set up yet
 * this card says so and the rest of Settings is unaffected.
 */
export function NotificationsCard() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!pushIsSupported()) {
      // iPhones only offer push to an app that is on the Home Screen.
      setState({ kind: isIosDevice() && !isInstalledApp() ? 'needs-install' : 'unsupported' });
      return;
    }
    if (isIosDevice() && !isInstalledApp()) {
      setState({ kind: 'needs-install' });
      return;
    }
    if (Notification.permission === 'denied') {
      setState({ kind: 'denied' });
      return;
    }

    const registration = await getRegistration();
    if (!registration) {
      setState({ kind: 'unavailable' });
      return;
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setState({ kind: 'off' });
      return;
    }

    try {
      const response = await postJson('/api/push/status', { endpoint: subscription.endpoint });
      const data = (await response.json()) as { subscribed?: boolean; topics?: PushTopic[] };
      setState(data.subscribed ? { kind: 'on', topics: data.topics ?? [] } : { kind: 'off' });
    } catch {
      setState({ kind: 'off' });
    }
  }, []);

  useEffect(() => {
    // Looking this up is the point of the effect: it reads the browser's own
    // push state, which does not exist on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function turnOn() {
    // Ask for permission FIRST, before any await: iOS only allows the prompt
    // inside the tap that triggered it, and an await first would lose that.
    const permissionRequest = Notification.requestPermission();
    setBusy(true);
    setMessage(null);

    try {
      const permission = await permissionRequest;
      if (permission !== 'granted') {
        setState({ kind: permission === 'denied' ? 'denied' : 'off' });
        return;
      }

      const keyResponse = await fetch('/api/push/key');
      if (!keyResponse.ok) {
        setState({ kind: 'unavailable' });
        return;
      }
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };

      const registration = await getRegistration();
      if (!registration) {
        setState({ kind: 'unavailable' });
        return;
      }

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const json = subscription.toJSON();
      const topics = [...PUSH_TOPICS];
      const response = await postJson('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
        topics,
      });
      if (!response.ok) throw new Error('save failed');

      setState({ kind: 'on', topics });
      setMessage({ tone: 'ok', text: 'Notifications are on for this device.' });
    } catch {
      setMessage({ tone: 'danger', text: 'Could not switch notifications on. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await postJson('/api/push/subscribe', { endpoint: subscription.endpoint }, 'DELETE');
        await subscription.unsubscribe();
      }
      setState({ kind: 'off' });
    } catch {
      setMessage({ tone: 'danger', text: 'Could not switch notifications off. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleTopic(topic: PushTopic, checked: boolean) {
    if (state.kind !== 'on') return;
    const topics = checked ? [...new Set([...state.topics, topic])] : state.topics.filter((t) => t !== topic);
    const previous = state;
    setState({ kind: 'on', topics });

    try {
      const registration = await getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error('no subscription');
      const json = subscription.toJSON();
      const response = await postJson('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
        topics,
      });
      if (!response.ok) throw new Error('save failed');
    } catch {
      setState(previous);
      setMessage({ tone: 'danger', text: 'Could not save that change. Try again.' });
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error('no subscription');
      const response = await postJson('/api/push/test', { endpoint: subscription.endpoint });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      setMessage(
        data.ok
          ? { tone: 'ok', text: 'Test sent. It should arrive in a few seconds.' }
          : { tone: 'danger', text: data.error ?? 'The test could not be delivered.' },
      );
    } catch {
      setMessage({ tone: 'danger', text: 'The test could not be sent.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="Alerts on this phone or computer. Each device chooses its own."
      />
      <CardBody className="flex flex-col gap-4">
        {state.kind === 'loading' ? <p className="text-sm text-muted">Checking this device…</p> : null}

        {state.kind === 'needs-install' ? (
          <Alert tone="warn">
            On an iPhone or iPad, notifications only work from the app on your Home Screen. Open Safari, tap
            Share, then Add to Home Screen, open the app from there, and come back to this page.
          </Alert>
        ) : null}

        {state.kind === 'unsupported' ? (
          <p className="text-sm text-muted">This browser does not support notifications.</p>
        ) : null}

        {state.kind === 'unavailable' ? (
          <p className="text-sm text-muted">
            Notifications are not available here yet. They only work on the live site once they have been set up.
          </p>
        ) : null}

        {state.kind === 'denied' ? (
          <Alert tone="warn">
            Notifications are blocked for this app. To allow them, open iPhone Settings, then Notifications, then
            Nolan Auto, and turn Allow Notifications on. On a computer, use the site settings in the browser.
          </Alert>
        ) : null}

        {state.kind === 'off' ? (
          <div>
            <Button onClick={() => void turnOn()} disabled={busy}>
              {busy ? 'Switching on…' : 'Turn on notifications'}
            </Button>
          </div>
        ) : null}

        {state.kind === 'on' ? (
          <>
            <div className="flex flex-col gap-3">
              {PUSH_TOPICS.map((topic) => (
                <label key={topic} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={state.topics.includes(topic)}
                    onChange={(event) => void toggleTopic(topic, event.target.checked)}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    <span className="font-medium text-ink">{PUSH_TOPIC_INFO[topic].label}</span>
                    <span className="block text-muted">{PUSH_TOPIC_INFO[topic].description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void sendTest()} disabled={busy}>
                Send a test
              </Button>
              <Button variant="ghost" onClick={() => void turnOff()} disabled={busy}>
                Turn off on this device
              </Button>
            </div>
          </>
        ) : null}

        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      </CardBody>
    </Card>
  );
}
