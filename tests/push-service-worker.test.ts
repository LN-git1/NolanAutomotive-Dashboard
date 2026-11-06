import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * Runs the real `public/sw.js` against a fake service-worker scope, because the
 * two things that matter on an iPhone are behaviours: a push ALWAYS ends in a
 * visible notification, and a tap only ever opens a page on this site.
 */
const source = readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

type Handler = (event: unknown) => void;

function loadWorker(windows: { url: string; focused?: string[]; navigated?: string[] }[] = []) {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const navigated: string[] = [];

  const clients = windows.map((w) => ({
    url: w.url,
    focus: async () => void focused.push(w.url),
    navigate: async (target: string) => void navigated.push(target),
  }));

  const scope = {
    location: { origin: 'https://dashboard.test' },
    addEventListener: (type: string, handler: Handler) => void (handlers[type] = handler),
    skipWaiting: () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => clients,
      openWindow: async (url: string) => void opened.push(url),
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }),
    },
  };

  vm.runInNewContext(source, { self: scope, caches: {}, URL, console, fetch: () => undefined });
  return { handlers, shown, opened, focused, navigated };
}

/** Fires a handler and waits for whatever it passed to `waitUntil`. */
async function fire(handler: Handler, event: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  handler({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

describe('service worker: push', () => {
  it('shows the notification it was sent', async () => {
    const worker = loadWorker();
    await fire(worker.handlers.push, {
      data: { json: () => ({ title: 'Good morning', body: '2 jobs booked in today: J1, J2.', url: '/schedule', tag: 'morning-summary' }) },
    });

    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].title).toBe('Good morning');
    expect(worker.shown[0].options.body).toBe('2 jobs booked in today: J1, J2.');
    expect(worker.shown[0].options.tag).toBe('morning-summary');
  });

  it('shows a plain notification even when the message is empty or unreadable (iOS cancels silent pushes)', async () => {
    const empty = loadWorker();
    await fire(empty.handlers.push, { data: null });
    expect(empty.shown).toHaveLength(1);
    expect(empty.shown[0].title).toBe('Nolan Automotive');

    const garbage = loadWorker();
    await fire(garbage.handlers.push, {
      data: { json: () => { throw new SyntaxError('not json'); } },
    });
    expect(garbage.shown).toHaveLength(1);

    const wrongTypes = loadWorker();
    await fire(wrongTypes.handlers.push, { data: { json: () => ({ title: 42, body: {}, url: 7, tag: [] }) } });
    expect(wrongTypes.shown).toHaveLength(1);
    expect(wrongTypes.shown[0].title).toBe('Nolan Automotive');
  });
});

describe('service worker: tapping a notification', () => {
  const click = (url: unknown) => ({ notification: { close: () => undefined, data: { url } } });

  it('opens the page the notification points at when the app is not open', async () => {
    const worker = loadWorker();
    await fire(worker.handlers.notificationclick, click('/schedule'));
    expect(worker.opened).toEqual(['https://dashboard.test/schedule']);
  });

  it('keeps the path, query and fragment of a page on this site, written either way', async () => {
    for (const [given, expected] of [
      ['/jobs?status=active#top', 'https://dashboard.test/jobs?status=active#top'],
      ['https://dashboard.test/schedule', 'https://dashboard.test/schedule'],
    ]) {
      const worker = loadWorker();
      await fire(worker.handlers.notificationclick, click(given));
      expect(worker.opened, given).toEqual([expected]);
    }
  });

  it('reuses an open window of the app instead of opening a second one', async () => {
    const worker = loadWorker([{ url: 'https://dashboard.test/jobs' }]);
    await fire(worker.handlers.notificationclick, click('/schedule'));
    expect(worker.focused).toEqual(['https://dashboard.test/jobs']);
    expect(worker.navigated).toEqual(['https://dashboard.test/schedule']);
    expect(worker.opened).toEqual([]);
  });

  it('only ever opens a page on this site, whatever the message asks for', async () => {
    for (const url of [
      'https://evil.example.com/x',
      '//evil.example.com/x',
      'javascript:alert(1)',
      '/\t/evil.example.com/x', // the URL parser strips the tab, leaving //evil.example.com/x
      '/\n/evil.example.com/x',
      '/\\evil.example.com/x', // a backslash is a slash to the URL parser
      '\\\\evil.example.com/x',
      'data:text/html,<script>alert(1)</script>',
      'https://dashboard.test.evil.example.com/x',
      'https://dashboard.test@evil.example.com/x',
      '',
      5,
      undefined,
    ]) {
      const worker = loadWorker();
      await fire(worker.handlers.notificationclick, click(url));
      expect(worker.opened, String(url)).toEqual(['https://dashboard.test/']);
    }
  });
});
