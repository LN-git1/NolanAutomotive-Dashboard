import { formatEur } from '@/lib/money';

/**
 * What a notification says. Built here, in one place, so the rule below is
 * easy to keep and easy to test.
 *
 * THE RULE: no customer details. A notification shows on a locked screen, on a
 * watch, and passes through Apple's and Google's servers, so it carries job
 * numbers, counts and supplier names (a business, not a person), and nothing
 * that names or identifies a customer: no customer name, phone, email or
 * registration.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path to open when the notification is tapped. */
  url: string;
  /** A notification with the same tag replaces the previous one instead of stacking. */
  tag: string;
}

const MAX_LISTED_JOBS = 4;

export interface MorningFacts {
  bookedToday: number;
  overdue: number;
  /** Job numbers booked for today, soonest first. Only the first few are shown. */
  jobNumbers: string[];
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function morningPayload(facts: MorningFacts): PushPayload {
  const { bookedToday, overdue } = facts;

  const overdueText =
    overdue > 0 ? ` ${overdue} ${plural(overdue, 'job is', 'jobs are')} overdue.` : '';

  let body: string;
  if (bookedToday === 0) {
    body = `Nothing booked in today.${overdueText}`;
  } else {
    const listed = facts.jobNumbers.slice(0, MAX_LISTED_JOBS).join(', ');
    const more = bookedToday > MAX_LISTED_JOBS ? ` and ${bookedToday - MAX_LISTED_JOBS} more` : '';
    body = `${bookedToday} ${plural(bookedToday, 'job', 'jobs')} booked in today: ${listed}${more}.${overdueText}`;
  }

  return { title: 'Good morning', body, url: '/schedule', tag: 'morning-summary' };
}

export function assignedPayload(input: { jobNumber: string; assigneeName: string }): PushPayload {
  return {
    title: 'Job assigned',
    body: `${input.jobNumber} was assigned to ${input.assigneeName}.`,
    url: '/jobs',
    tag: `assigned-${input.jobNumber}`,
  };
}

export function supplierBalancePayload(input: {
  supplierName: string;
  supplierId: string;
  level: 80 | 100;
  balanceCents: number;
  limitCents: number;
}): PushPayload {
  const { supplierName, level, balanceCents, limitCents } = input;
  const body =
    level === 100
      ? `We owe ${supplierName} ${formatEur(balanceCents)}, which is at or over the ${formatEur(limitCents)} limit.`
      : `We owe ${supplierName} ${formatEur(balanceCents)}, 80% of the ${formatEur(limitCents)} limit.`;

  return {
    title: level === 100 ? 'Supplier limit reached' : 'Supplier balance at 80%',
    body,
    url: `/suppliers/${input.supplierId}`,
    tag: `supplier-${input.supplierId}-${level}`,
  };
}

/**
 * Problems with the app itself. Only the ones a phone can honestly be told:
 * the notification list lives in the database, so when the database is fully
 * unreachable the app cannot look up whose phones to notify. That case is
 * covered by the e-mail and the message to ZB Automations that already exist;
 * "database-down" here only gets through when the database is struggling
 * rather than gone (for example a connection pool that has run out).
 */
export type SystemAlertKind =
  | 'database-down'
  | 'database-slow'
  | 'save-failed'
  | 'page-crashed'
  | 'digest-failed';

const SYSTEM_TEXT: Record<SystemAlertKind, { title: string; body: string }> = {
  'database-down': {
    title: 'App problem: database unreachable',
    body: 'The dashboard could not reach its database. ZB Automations has been told.',
  },
  'database-slow': {
    title: 'App is running slowly',
    body: 'The database is taking a long time to answer. ZB Automations has been told.',
  },
  'save-failed': {
    title: 'A save failed',
    body: 'Something you tried to save did not go through. Check it and try again.',
  },
  'page-crashed': {
    title: 'A page crashed',
    body: 'A screen in the app hit an error. ZB Automations has been told.',
  },
  'digest-failed': {
    title: 'Activity email failed',
    body: 'The 3-hourly activity email could not be sent.',
  },
};

export function systemPayload(kind: SystemAlertKind): PushPayload {
  const text = SYSTEM_TEXT[kind];
  return { title: text.title, body: text.body, url: '/', tag: `system-${kind}` };
}

/**
 * The note that follows every new version going live. `failures` are the checks
 * that did not pass; none means everything did. Names the business, not the
 * owner (the public voice rule), and only ever carries the version and counts.
 */
export function buildPayload(input: { sha: string; failures: readonly string[] }): PushPayload {
  const version = input.sha.slice(0, 7);

  if (input.failures.length === 0) {
    return {
      title: 'New version is live',
      body: `Version ${version} is live and passed all its checks. Have a quick look to make sure it works.`,
      url: '/',
      tag: 'system-build',
    };
  }

  const count = input.failures.length;
  return {
    title: 'New version needs attention',
    body: `Version ${version} went live but ${count} ${count === 1 ? 'check' : 'checks'} failed. ZB Automations has been told. Contact us if anything looks wrong.`,
    url: '/',
    tag: 'system-build',
  };
}
