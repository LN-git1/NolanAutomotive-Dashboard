/**
 * The kinds of notification a phone can switch on, each on its own. Shared by
 * the server (who to send to) and the Settings card (what to show), so the two
 * can never disagree about what exists.
 */
export const PUSH_TOPICS = ['morning', 'assigned', 'supplier', 'system'] as const;

export type PushTopic = (typeof PUSH_TOPICS)[number];

export const PUSH_TOPIC_INFO: Record<PushTopic, { label: string; description: string }> = {
  morning: {
    label: 'Morning summary',
    description: 'Every day at 9am: the jobs booked in today and how many are overdue.',
  },
  assigned: {
    label: 'Job assigned',
    description: 'When a job is given to someone.',
  },
  supplier: {
    label: 'Supplier balances',
    description: 'When what we owe a supplier reaches 80% of its limit, and again when it hits the limit.',
  },
  system: {
    label: 'App alerts',
    description: 'Problems with the app, and a check after each new version goes live.',
  },
};

export function isPushTopic(value: unknown): value is PushTopic {
  return typeof value === 'string' && (PUSH_TOPICS as readonly string[]).includes(value);
}

/** Drops anything that is not a known topic and removes duplicates. */
export function cleanTopics(input: unknown): PushTopic[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isPushTopic))];
}
