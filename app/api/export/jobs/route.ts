import { desc, isNull } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { csvResponse, toCsv } from '@/lib/csv';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { todayIsoDate } from '@/lib/format';

export const runtime = 'nodejs';

/**
 * Full job export. Includes customer personal data, so it is auth-gated like
 * everything else and served with no-store.
 *
 * Internal notes are deliberately included: this export exists partly to give
 * the owner a way to take their own data with them, which is a GDPR
 * portability consideration, not just a convenience.
 */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  const rows = await db
    .select()
    .from(jobs)
    .where(isNull(jobs.deletedAt))
    .orderBy(desc(jobs.createdAt));

  const csv = toCsv(
    rows.map((job) => ({
      jobNumber: job.jobNumber,
      status: job.status,
      priority: job.priority,
      dueDate: job.dueDate,
      dueTime: job.dueTime,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      customerEmail: job.customerEmail,
      customerAddress: job.customerAddress,
      vehicleRegistration: job.vehicleRegistration,
      vehicleMake: job.vehicleMake,
      vehicleModel: job.vehicleModel,
      vehicleYear: job.vehicleYear,
      vehicleColor: job.vehicleColor,
      vehicleMileage: job.vehicleMileage,
      vehicleVin: job.vehicleVin,
      notes: job.notes,
      createdAt: job.createdAt,
    })),
    [
      { key: 'jobNumber', header: 'Job number' },
      { key: 'status', header: 'Status' },
      { key: 'priority', header: 'Priority' },
      { key: 'dueDate', header: 'Due date' },
      { key: 'dueTime', header: 'Due time' },
      { key: 'customerName', header: 'Customer name' },
      { key: 'customerPhone', header: 'Customer phone' },
      { key: 'customerEmail', header: 'Customer email' },
      { key: 'customerAddress', header: 'Customer address' },
      { key: 'vehicleRegistration', header: 'Registration' },
      { key: 'vehicleMake', header: 'Make' },
      { key: 'vehicleModel', header: 'Model' },
      { key: 'vehicleYear', header: 'Year' },
      { key: 'vehicleColor', header: 'Colour' },
      { key: 'vehicleMileage', header: 'Mileage' },
      { key: 'vehicleVin', header: 'VIN' },
      { key: 'notes', header: 'Notes' },
      { key: 'createdAt', header: 'Created' },
    ],
  );

  return csvResponse(csv, `nolan-jobs-${todayIsoDate()}.csv`);
}
