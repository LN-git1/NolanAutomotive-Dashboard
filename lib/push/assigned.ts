import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { assignees, jobs } from '@/lib/db/schema';

import { assignedPayload } from './payload';
import { sendPush } from './send';

/**
 * "Job NA-0042 was assigned to Mick."
 *
 * Called after a job is saved, with only the people who were NEWLY added to it
 * (the caller works that out from the before and after lists), so re-saving a
 * job without changing who is on it sends nothing.
 *
 * It goes to every device with "Job assigned" switched on, including the phone
 * that made the change: there is one owner login, so the app cannot tell who
 * is holding which phone. That is by design, and the Settings card says each
 * device chooses its own.
 */
export async function notifyAssigned(jobId: string, addedAssigneeIds: string[]): Promise<void> {
  if (addedAssigneeIds.length === 0) return;

  const [job] = await db
    .select({ jobNumber: jobs.jobNumber })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return;

  const people = await db
    .select({ name: assignees.name })
    .from(assignees)
    .where(inArray(assignees.id, addedAssigneeIds));
  if (people.length === 0) return;

  const names = people.map((person) => person.name);
  const assigneeName =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  await sendPush('assigned', assignedPayload({ jobNumber: job.jobNumber, assigneeName }));
}
