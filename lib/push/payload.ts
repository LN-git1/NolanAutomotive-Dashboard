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

export type SystemAlertKind =
  | 'database-down'
  | 'database-recovered'
  | 'save-failed'
  | 'page-crashed'
  | 'database-slow'
  | 'digest-failed'
  | 'storage-failed'
  | 'push-failing'
  | 'build-live'
  | 'build-check-failed';

const SYSTEM_TEXT: Record<SystemAlertKind, { title: string; body: string }> = {
  'database-down': {
    title: 'App problem: database unreachable',
    body: 'The dashboard cannot reach its database. ZB Automations has been told.',
  },
  'database-recovered': {
    title: 'Database is back',
    body: 'The dashboard can reach its database again.',
  },
  'save-failed': {
    title: 'A save failed',
    body: 'Something you tried to save did not go through. Check it and try again.',
  },
  'page-crashed': {
    title: 'A page crashed',
    body: 'A screen in the app hit an error. ZB Automations has been told.',
  },
  'database-slow': {
    title: 'App is running slowly',
    body: 'The database is taking several tries to answer. ZB Automations has been told.',
  },
  'digest-failed': {
    title: 'Activity email failed',
    body: 'The 3-hourly activity email could not be sent.',
  },
  'storage-failed': {
    title: 'File storage problem',
    body: 'Receipts or invoice files could not be saved or opened.',
  },
  'push-failing': {
    title: 'Notifications are failing',
    body: 'Notifications could not be delivered to any device.',
  },
  'build-live': {
    title: 'New version is live',
    body: 'A new version of the dashboard is live and passed its checks. Please have a quick look at it.',
  },
  'build-check-failed': {
    title: 'New version needs attention',
    body: 'A new version went live but a check failed. ZB Automations has been told. Contact us if anything looks wrong.',
  },
};

export function systemPayload(kind: SystemAlertKind): PushPayload {
  const text = SYSTEM_TEXT[kind];
  return { title: text.title, body: text.body, url: '/', tag: `system-${kind}` };
}
