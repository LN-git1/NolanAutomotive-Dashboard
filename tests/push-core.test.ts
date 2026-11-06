import { describe, expect, it } from 'vitest';

import { dublinClock, isMorningWindow } from '@/lib/push/dublin';
import { isAllowedPushEndpoint } from '@/lib/push/endpoints';
import { assignedPayload, buildPayload, morningPayload, supplierBalancePayload, systemPayload } from '@/lib/push/payload';
import type { SystemAlertKind } from '@/lib/push/payload';
import { hasValidBearer } from '@/lib/push/secret';
import { readVapidConfig } from '@/lib/push/send';
import { cleanTopics, PUSH_TOPICS } from '@/lib/push/topics';

describe('push endpoint allowlist', () => {
  it('accepts the real push services over https', () => {
    for (const endpoint of [
      'https://web.push.apple.com/QWxhZGRpbjpvcGVu',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://db5p.notify.windows.com/?token=abc',
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it('rejects anything else, so the server cannot be pointed at an arbitrary address', () => {
    for (const endpoint of [
      'http://web.push.apple.com/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/abc',
      'https://evil.example.com/web.push.apple.com',
      'https://web.push.apple.com.evil.com/abc',
      'https://user:pass@web.push.apple.com/abc',
      'https://web.push.apple.com:8443/abc',
      'ftp://web.push.apple.com/abc',
      'not a url',
      '',
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});

describe('morning window (Europe/Dublin, not the server clock)', () => {
  it('is open from 9am to before midday Dublin time, in winter (GMT)', () => {
    expect(isMorningWindow(new Date('2026-01-15T08:59:00Z'))).toBe(false);
    expect(isMorningWindow(new Date('2026-01-15T09:00:00Z'))).toBe(true);
    expect(isMorningWindow(new Date('2026-01-15T11:59:00Z'))).toBe(true);
    expect(isMorningWindow(new Date('2026-01-15T12:00:00Z'))).toBe(false);
  });

  it('follows summer time too: 9am Dublin is 08:00 UTC', () => {
    expect(isMorningWindow(new Date('2026-07-15T07:59:00Z'))).toBe(false);
    expect(isMorningWindow(new Date('2026-07-15T08:00:00Z'))).toBe(true);
    expect(isMorningWindow(new Date('2026-07-15T10:59:00Z'))).toBe(true);
    expect(isMorningWindow(new Date('2026-07-15T11:00:00Z'))).toBe(false);
  });

  it('reads the Dublin date, so just after midnight in summer is already the next day', () => {
    // 23:30 UTC on 14 July is 00:30 on 15 July in Dublin.
    expect(dublinClock(new Date('2026-07-14T23:30:00Z')).date).toBe('2026-07-15');
    expect(dublinClock(new Date('2026-01-14T23:30:00Z')).date).toBe('2026-01-14');
  });

  it('runs every day of the week, with no day off', () => {
    // 2026-11-07 is a Saturday and 2026-11-08 a Sunday.
    expect(isMorningWindow(new Date('2026-11-07T09:30:00Z'))).toBe(true);
    expect(isMorningWindow(new Date('2026-11-08T09:30:00Z'))).toBe(true);
  });
});

describe('notification text', () => {
  it('says so on a day with nothing booked', () => {
    expect(morningPayload({ bookedToday: 0, overdue: 0, jobNumbers: [] }).body).toBe('Nothing booked in today.');
  });

  it('still reports overdue jobs on a quiet day', () => {
    expect(morningPayload({ bookedToday: 0, overdue: 2, jobNumbers: [] }).body).toBe(
      'Nothing booked in today. 2 jobs are overdue.',
    );
    expect(morningPayload({ bookedToday: 0, overdue: 1, jobNumbers: [] }).body).toContain('1 job is overdue');
  });

  it('lists the first jobs and counts the rest', () => {
    const body = morningPayload({
      bookedToday: 6,
      overdue: 0,
      jobNumbers: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'],
    }).body;
    expect(body).toBe('6 jobs booked in today: J1, J2, J3, J4 and 2 more.');
    expect(morningPayload({ bookedToday: 1, overdue: 0, jobNumbers: ['J9'] }).body).toBe('1 job booked in today: J9.');
  });

  it('never carries customer details: job numbers, counts and supplier names only', () => {
    // Every payload builder takes only the fields below, so there is nowhere for
    // a customer name, phone, email or registration to enter. Spot-check the
    // output of each against the kinds of text a customer record contains.
    const kinds: SystemAlertKind[] = ['database-down', 'database-slow', 'save-failed', 'page-crashed', 'digest-failed'];
    const all = [
      morningPayload({ bookedToday: 2, overdue: 1, jobNumbers: ['NA-001', 'NA-002'] }),
      assignedPayload({ jobNumber: 'NA-001', assigneeName: 'Mick' }),
      supplierBalancePayload({ supplierName: 'Parts Ltd', supplierId: 'abc', level: 80, balanceCents: 80000, limitCents: 100000 }),
      ...kinds.map((kind) => systemPayload(kind)),
      buildPayload({ sha: '346800b3d2674bd35b48d196beb64fc86b39cbc9', failures: [] }),
      buildPayload({ sha: '346800b3d2674bd35b48d196beb64fc86b39cbc9', failures: ['login page'] }),
    ];

    for (const payload of all) {
      const text = `${payload.title} ${payload.body}`;
      expect(text).not.toMatch(/@/); // no email address
      expect(text).not.toMatch(/\b0\d{2}[ -]?\d{3}[ -]?\d{4}\b|\+353/); // no phone number
      expect(text).not.toMatch(/\b\d{2,3}-?[A-Z]{1,2}-?\d{1,6}\b/); // no Irish registration plate
      expect(payload.url.startsWith('/')).toBe(true);
      expect(payload.url.startsWith('//')).toBe(false);
    }
  });

  it('describes both supplier alerts with the amounts', () => {
    const at80 = supplierBalancePayload({ supplierName: 'Parts Ltd', supplierId: 's1', level: 80, balanceCents: 80000, limitCents: 100000 });
    const at100 = supplierBalancePayload({ supplierName: 'Parts Ltd', supplierId: 's1', level: 100, balanceCents: 100000, limitCents: 100000 });
    expect(at80.title).toContain('80%');
    expect(at80.body).toContain('€800.00');
    expect(at100.title).toContain('limit reached');
    expect(at100.tag).not.toBe(at80.tag);
  });

  it('names the business, never the owner, in the app alerts and build notices', () => {
    const all = [
      ...(['database-down', 'database-slow', 'save-failed', 'page-crashed', 'digest-failed'] as const).map((kind) => systemPayload(kind)),
      buildPayload({ sha: 'abcdef1234567', failures: [] }),
      buildPayload({ sha: 'abcdef1234567', failures: ['a'] }),
    ];
    for (const { title, body } of all) expect(`${title} ${body}`).not.toMatch(/Zach/);
  });

  it('the build notice reports the short version and how many checks failed', () => {
    expect(buildPayload({ sha: '346800b3d2674bd35b48d196beb64fc86b39cbc9', failures: [] }).body).toContain('Version 346800b is live and passed all its checks');
    const one = buildPayload({ sha: '346800b3d2674bd35b48d196beb64fc86b39cbc9', failures: ['login page'] });
    expect(one.title).toBe('New version needs attention');
    expect(one.body).toContain('1 check failed');
    expect(buildPayload({ sha: '346800b', failures: ['a', 'b', 'c'] }).body).toContain('3 checks failed');
  });
});

describe('scheduler secret', () => {
  const request = (header?: string) =>
    new Request('https://x.test/api/push/scheduled', { headers: header ? { authorization: header } : {} });

  it('accepts only the exact bearer secret', () => {
    expect(hasValidBearer(request('Bearer s3cret'), 's3cret')).toBe(true);
    expect(hasValidBearer(request('Bearer s3cret x'), 's3cret')).toBe(false);
    expect(hasValidBearer(request('Bearer s3cre'), 's3cret')).toBe(false);
    expect(hasValidBearer(request('bearer s3cret'), 's3cret')).toBe(false);
    expect(hasValidBearer(request('Bearer other'), 's3cret')).toBe(false);
    expect(hasValidBearer(request('s3cret'), 's3cret')).toBe(false);
    expect(hasValidBearer(request(), 's3cret')).toBe(false);
  });

  it('never matches when no secret is configured, even with an empty header', () => {
    expect(hasValidBearer(request('Bearer '), undefined)).toBe(false);
    expect(hasValidBearer(request('Bearer '), '')).toBe(false);
    expect(hasValidBearer(request(), undefined)).toBe(false);
  });
});

describe('push configuration', () => {
  it('is off unless all three keys are set and the contact is a mailto or https address', () => {
    expect(readVapidConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      readVapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'zach' } as unknown as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      readVapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:x@y.ie' } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ publicKey: 'a', privateKey: 'b', subject: 'mailto:x@y.ie' });
  });

  it('keeps only known topics, once each', () => {
    expect(cleanTopics(['morning', 'morning', 'bogus', 7, 'system'])).toEqual(['morning', 'system']);
    expect(cleanTopics('morning')).toEqual([]);
    expect(PUSH_TOPICS).toEqual(['morning', 'assigned', 'supplier', 'system']);
  });
});
