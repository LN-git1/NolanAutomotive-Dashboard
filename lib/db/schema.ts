import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * `new` was removed: a job that exists is a job that is active, so the extra
 * state earned nothing and only added a tap. Postgres cannot drop a value from
 * an enum, so the migration swaps the type and remaps any `new` row to `active`.
 */
export const jobStatusEnum = pgEnum('job_status', [
  'active',
  'completed',
  'invoiced',
  'paid',
]);

export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high']);

export const sentViaEnum = pgEnum('sent_via', ['email', 'whatsapp', 'share']);

export const counterKeyEnum = pgEnum('counter_key', ['invoice', 'job']);

/**
 * Shared allocator for the two sequences that must never collide or reuse a
 * value: invoice numbers and job numbers. Rows are locked FOR UPDATE inside the
 * same transaction as the insert they number — see `lib/counters.ts`.
 *
 * A plain Postgres SEQUENCE was rejected deliberately: sequences are
 * non-transactional and burn values on rollback, which would put gaps in a
 * legally significant invoice run.
 */
export const counters = pgTable('counters', {
  key: counterKeyEnum('key').primaryKey(),
  nextValue: integer('next_value').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Singleton configuration row. `id` is pinned to 1 by convention and by seed. */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  businessName: text('business_name'),
  businessAddress: text('business_address'),
  businessPhone: text('business_phone'),
  businessEmail: text('business_email'),
  vatRegistered: boolean('vat_registered').notNull().default(false),
  vatNumber: text('vat_number'),
  defaultVatRate: numeric('default_vat_rate', { precision: 5, scale: 2 })
    .notNull()
    .default('23.00'),
  defaultHourlyRate: numeric('default_hourly_rate', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One labour line as printed in the template's WORK CARRIED OUT table: a
 * description and the hours spent on it. The template's second column is
 * HOUR(S), not money — the euro figure appears only in the SUBTOTAL box.
 */
export interface LabourLine {
  description: string;
  /** Decimal string, e.g. "2.5". Empty means "no billable time", and prints blank. */
  hours: string;
}

/**
 * A part as the owner entered it on the job. There is deliberately no `amount`:
 * the line total is derived (qty x unitPrice) at invoice time, so a stored copy
 * could only ever go stale or disagree with the arithmetic.
 */
export interface JobPartLine {
  partName: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
}

/** The same line once priced, as snapshotted onto an issued invoice. */
export interface InvoicePartLine extends JobPartLine {
  amount: string;
}

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobNumber: text('job_number').notNull(),
    status: jobStatusEnum('status').notNull().default('active'),
    priority: priorityEnum('priority').notNull().default('medium'),
    dueDate: date('due_date'),

    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    customerEmail: text('customer_email'),
    customerAddress: text('customer_address'),

    vehicleRegistration: text('vehicle_registration').notNull(),
    // The invoice template prints "Make:" and "Model:" on separate lines, so
    // these are stored separately rather than as one combined makeModel field.
    vehicleMake: text('vehicle_make'),
    vehicleModel: text('vehicle_model'),
    vehicleVin: text('vehicle_vin'),
    vehicleMileage: integer('vehicle_mileage'),
    vehicleYear: integer('vehicle_year'),
    vehicleColor: text('vehicle_color'),

    /**
     * The invoice content lives on the job, not on the invoice.
     *
     * This is the whole point of the job-centred rework: the owner enters the
     * work once, on the job, and it stays editable forever. Regenerating an
     * invoice re-reads these, which is why a sent invoice can be corrected
     * without the job and the document ever disagreeing.
     */
    labourLines: jsonb('labour_lines').notNull().default([]).$type<LabourLine[]>(),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }),
    /** A flat labour figure. When set it wins over hours x rate entirely. */
    labourTotalOverride: numeric('labour_total_override', { precision: 12, scale: 2 }),
    parts: jsonb('parts').notNull().default([]).$type<JobPartLine[]>(),
    otherComments: text('other_comments'),

    /** Private. Never printed on an invoice. */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete. Every list query must filter `deletedAt IS NULL`. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('jobs_job_number_key').on(table.jobNumber),
    index('jobs_status_idx').on(table.status),
    index('jobs_vehicle_registration_idx').on(table.vehicleRegistration),
    index('jobs_customer_name_idx').on(table.customerName),
    index('jobs_deleted_at_idx').on(table.deletedAt),
  ],
);

export const jobAttachments = pgTable(
  'job_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    /** Bucket-relative path. Never a public URL — access is via signed URLs only. */
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type'),
    fileSizeBytes: integer('file_size_bytes'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('job_attachments_job_id_idx').on(table.jobId)],
);

/**
 * An invoice row exists only once the owner has actually sent/shared it — there
 * is no draft state. Previewing in the Invoicer writes nothing, which is what
 * keeps the invoice number sequence gap-free.
 *
 * The row still snapshots its own totals rather than deriving them from the job,
 * so exports and the money-owed figures stay correct even as the job is edited.
 * Regenerating rewrites the snapshot from the job.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: text('invoice_number').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    issueDate: date('issue_date').notNull(),

    /** Snapshot of the job's labour lines at the moment this was last sent. */
    labourLines: jsonb('labour_lines').notNull().default([]).$type<LabourLine[]>(),
    labourTotalOverride: numeric('labour_total_override', { precision: 12, scale: 2 }),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }),

    /**
     * Retained for invoices issued before labour lines existed, so an old
     * document still reproduces exactly as it was sent. New invoices leave
     * these null and use `labourLines` instead.
     */
    workCarriedOut: text('work_carried_out'),
    labourHours: numeric('labour_hours', { precision: 8, scale: 2 }),

    /**
     * The physical column names still say "services" while the code says
     * "labour". Renaming them would mean an ALTER on a live table carrying
     * issued invoices, for zero functional gain — Drizzle maps the name here
     * instead, so the code reads correctly and the data is never at risk.
     */
    labourSubtotal: numeric('services_subtotal', { precision: 12, scale: 2 }).notNull(),
    partsSubtotal: numeric('parts_subtotal', { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull(),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull(),
    totalLabour: numeric('total_services', { precision: 12, scale: 2 }).notNull(),
    totalParts: numeric('total_parts', { precision: 12, scale: 2 }).notNull(),
    grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).notNull(),

    parts: jsonb('parts').notNull().$type<InvoicePartLine[]>(),
    otherComments: text('other_comments'),

    pdfStoragePath: text('pdf_storage_path').notNull(),

    /**
     * Issued and sent are different events, so these are nullable.
     *
     * The invoice is created the moment it is generated — that is what makes
     * sending instant instead of a second ten-second wait. Delivery happens
     * afterwards, or not at all, so an invoice can legitimately exist with no
     * channel recorded yet. `createdAt` is when it was issued; `sentAt` is when
     * it actually went to the customer.
     */
    sentVia: sentViaEnum('sent_via'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Voiding never deletes: the number stays consumed so the sequence keeps no
     * gaps, the document remains reconstructable for tax purposes, and the job
     * is freed to be invoiced again under a fresh number.
     */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    uniqueIndex('invoices_invoice_number_key').on(table.invoiceNumber),
    index('invoices_job_id_idx').on(table.jobId),
    index('invoices_voided_at_idx').on(table.voidedAt),
  ],
);

/**
 * Money actually received against an invoice. Deliberately its own row per
 * payment, not a running total on `invoices` or `jobs`: real billing here
 * involves a deposit now and a balance later, and each of those needs its
 * own record. "Owed" (`invoices.grandTotal` minus the sum of these) and
 * "paid" (`jobs.status`) are both derived from this table, not stored
 * redundantly — a job only ever flips to `paid` once the running total
 * reaches `grandTotal`.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payments_invoice_id_idx').on(table.invoiceId)],
);

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierBills = pgTable(
  'supplier_bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    billDate: date('bill_date').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    attachmentStoragePath: text('attachment_storage_path'),
    /** NULL means still outstanding — this drives the "owed to others" totals. */
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('supplier_bills_supplier_id_idx').on(table.supplierId),
    index('supplier_bills_paid_at_idx').on(table.paidAt),
  ],
);

export const jobsRelations = relations(jobs, ({ many }) => ({
  attachments: many(jobAttachments),
  invoices: many(invoices),
}));

export const jobAttachmentsRelations = relations(jobAttachments, ({ one }) => ({
  job: one(jobs, { fields: [jobAttachments.jobId], references: [jobs.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  job: one(jobs, { fields: [invoices.jobId], references: [jobs.id] }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  bills: many(supplierBills),
}));

export const supplierBillsRelations = relations(supplierBills, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierBills.supplierId], references: [suppliers.id] }),
}));

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];
export type SentVia = (typeof sentViaEnum.enumValues)[number];
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type JobAttachment = typeof jobAttachments.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type SupplierBill = typeof supplierBills.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Settings = typeof settings.$inferSelect;
