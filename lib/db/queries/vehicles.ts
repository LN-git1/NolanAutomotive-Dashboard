import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '../index';
import { jobs } from '../schema';

/**
 * The vehicle "record" for a registration — assembled from the jobs, not stored.
 *
 * There is deliberately no `vehicles` or `customers` table behind this. Every
 * field a returning customer needs is already on the job that brought the car
 * in last time, and `jobs` is the record the owner edits forever (see the
 * jobs table's `labourLines` docstring). A second copy of the same name, phone
 * and address would have to be kept in step with every job edit, and the first
 * time the two disagreed there would be no way to tell which was right.
 *
 * Deriving instead means the history is correct by construction: fix a typo in
 * a customer's phone number on the job, and the next lookup for that reg offers
 * the corrected one. Nothing to backfill, nothing to sync, nothing to drift.
 *
 * The trade is a slightly heavier query, which is bounded by the search's own
 * LIMIT and served by `jobs_vehicle_registration_norm_idx`.
 */

/**
 * Registrations are stored exactly as the owner typed them, because that is
 * what should print on the invoice — Irish plates are written `142-KY-9821`
 * and reproducing that matters on a document. Matching them is a different
 * question: someone searching for that car will type `142KY9821`, `142 ky 9821`
 * or the hyphenated form interchangeably, and all three mean the same vehicle.
 *
 * So comparison happens on a normalised form — upper-cased, every separator
 * stripped — while storage and display keep the typed original. This is also
 * why the fix is an expression, not an `UPDATE`: rewriting the stored values
 * would destroy the formatting the invoice depends on to solve a problem that
 * only exists at comparison time.
 */
/**
 * The normalised registration of the `jobs` row in scope, for use inside the
 * Drizzle query builder — it renders the fully-qualified column, so it is safe
 * anywhere `jobs` is in the FROM.
 *
 * Backed by `jobs_vehicle_registration_norm_idx`, which indexes this exact
 * expression. Change one and the other stops being used.
 */
export const NORMALIZED_REGISTRATION = sql<string>`upper(regexp_replace(${jobs.vehicleRegistration}, '[^A-Za-z0-9]', '', 'g'))`;

/** The same normalisation applied to a search term, in JS rather than in SQL. */
export function normalizeRegistration(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export interface VehicleMatch {
  normalizedRegistration: string;
  /** As last typed, separators and all — what prints on the invoice. */
  registration: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehicleColor: string | null;
  vehicleVin: string | null;
  vehicleMileage: number | null;
  /** The job these details were copied from, so the form can name its source. */
  lastJobNumber: string;
  jobCount: number;
  firstVisit: string;
  lastVisit: string;
  /** Billed across every live invoice on this vehicle, in cents. */
  totalBilledCents: number;
  /** Actually received against those invoices, in cents. */
  totalPaidCents: number;
}

/**
 * One row per job, with the live invoice's figures attached.
 *
 * A LATERAL rather than a plain join: `invoices` has no unique constraint on
 * `job_id`, so a job carrying two non-voided rows would otherwise be counted
 * twice and double its contribution to "total spent". Taking the most recent
 * live invoice per job makes the aggregate safe whatever the invoice table
 * holds.
 */
const SCOPED_JOBS = sql`
  SELECT
    j.id,
    j.job_number,
    j.created_at,
    j.due_date,
    j.status,
    j.customer_name,
    j.customer_phone,
    j.customer_email,
    j.customer_address,
    j.vehicle_registration,
    j.vehicle_make,
    j.vehicle_model,
    j.vehicle_year,
    j.vehicle_color,
    j.vehicle_vin,
    j.vehicle_mileage,
    upper(regexp_replace(j.vehicle_registration, '[^A-Za-z0-9]', '', 'g')) AS norm,
    COALESCE(inv.grand_total, 0) AS billed,
    COALESCE(inv.paid, 0) AS paid
  FROM jobs j
  LEFT JOIN LATERAL (
    SELECT
      i.grand_total,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
    FROM invoices i
    WHERE i.job_id = j.id AND i.voided_at IS NULL
    ORDER BY i.created_at DESC
    LIMIT 1
  ) inv ON TRUE
  WHERE j.deleted_at IS NULL
`;

/**
 * Vehicles matching a partial registration, customer name or job number.
 *
 * Partial-reg matching is the point: typing `98D` is how the owner asks "which
 * of the 1998 Dublin cars was it?", and the answer is a short list to pick from
 * rather than a single guess. Customer name is matched too, because the other
 * half of the same question is "what does this customer drive?" — one person
 * with three cars gets three rows, and any of them can be picked.
 *
 * Grouped by the normalised registration, so one car is one row however its
 * plate was punctuated on each visit.
 */
export async function searchVehicles(term: string, limit = 8): Promise<VehicleMatch[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  const normPattern = `%${normalizeRegistration(trimmed)}%`;
  const textPattern = `%${trimmed}%`;

  const rows = await db.execute<{
    normalizedRegistration: string;
    registration: string;
    customerName: string;
    customerPhone: string | null;
    customerEmail: string | null;
    customerAddress: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehicleYear: number | null;
    vehicleColor: string | null;
    vehicleVin: string | null;
    vehicleMileage: number | null;
    lastJobNumber: string;
    jobCount: number;
    firstVisit: string;
    lastVisit: string;
    totalBilledCents: string;
    totalPaidCents: string;
  }>(sql`
    WITH scoped AS (${SCOPED_JOBS}),
    matching AS (
      SELECT DISTINCT norm
      FROM scoped
      WHERE norm LIKE ${normPattern}
         OR customer_name ILIKE ${textPattern}
         OR job_number ILIKE ${textPattern}
    )
    SELECT
      s.norm AS "normalizedRegistration",
      (array_agg(s.vehicle_registration ORDER BY s.created_at DESC))[1] AS "registration",
      (array_agg(s.customer_name        ORDER BY s.created_at DESC))[1] AS "customerName",
      (array_agg(s.customer_phone       ORDER BY s.created_at DESC))[1] AS "customerPhone",
      (array_agg(s.customer_email       ORDER BY s.created_at DESC))[1] AS "customerEmail",
      (array_agg(s.customer_address     ORDER BY s.created_at DESC))[1] AS "customerAddress",
      (array_agg(s.vehicle_make         ORDER BY s.created_at DESC))[1] AS "vehicleMake",
      (array_agg(s.vehicle_model        ORDER BY s.created_at DESC))[1] AS "vehicleModel",
      (array_agg(s.vehicle_year         ORDER BY s.created_at DESC))[1] AS "vehicleYear",
      (array_agg(s.vehicle_color        ORDER BY s.created_at DESC))[1] AS "vehicleColor",
      (array_agg(s.vehicle_vin          ORDER BY s.created_at DESC))[1] AS "vehicleVin",
      (array_agg(s.vehicle_mileage      ORDER BY s.created_at DESC))[1] AS "vehicleMileage",
      (array_agg(s.job_number           ORDER BY s.created_at DESC))[1] AS "lastJobNumber",
      count(*)::int   AS "jobCount",
      min(s.created_at) AS "firstVisit",
      max(s.created_at) AS "lastVisit",
      (SUM(s.billed) * 100)::bigint AS "totalBilledCents",
      (SUM(s.paid)   * 100)::bigint AS "totalPaidCents"
    FROM scoped s
    JOIN matching m ON m.norm = s.norm
    GROUP BY s.norm
    ORDER BY max(s.created_at) DESC
    LIMIT ${limit}
  `);

  // `db.execute` hands back whatever the driver produced, so the numeric
  // aggregates arrive as strings. Converted here rather than at each call site,
  // so a caller can never accidentally add two of them as text.
  return rows.map((row) => ({
    ...row,
    jobCount: Number(row.jobCount),
    totalBilledCents: Number(row.totalBilledCents),
    totalPaidCents: Number(row.totalPaidCents),
  }));
}

export interface VehicleHistoryEntry {
  id: string;
  jobNumber: string;
  status: string;
  createdAt: string;
  dueDate: string | null;
  billedCents: number;
  paidCents: number;
}

/**
 * Every job ever done on one vehicle, newest first.
 *
 * Keyed on the normalised registration for the same reason the search is, so a
 * car booked in once as `142-KY-9821` and once as `142KY9821` shows one
 * history rather than two half-histories.
 */
export async function getVehicleHistory(registration: string): Promise<VehicleHistoryEntry[]> {
  const norm = normalizeRegistration(registration);
  if (norm === '') return [];

  const rows = await db.execute<{
    id: string;
    jobNumber: string;
    status: string;
    createdAt: string;
    dueDate: string | null;
    billedCents: string;
    paidCents: string;
  }>(sql`
    WITH scoped AS (${SCOPED_JOBS})
    SELECT
      s.id,
      s.job_number  AS "jobNumber",
      s.status,
      s.created_at  AS "createdAt",
      s.due_date    AS "dueDate",
      (s.billed * 100)::bigint AS "billedCents",
      (s.paid   * 100)::bigint AS "paidCents"
    FROM scoped s
    WHERE s.norm = ${norm}
    ORDER BY s.created_at DESC
    LIMIT 100
  `);

  return rows.map((row) => ({
    ...row,
    billedCents: Number(row.billedCents),
    paidCents: Number(row.paidCents),
  }));
}
