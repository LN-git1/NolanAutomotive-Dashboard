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

export const jobStatusEnum = pgEnum('job_status', [
  'new',
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

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobNumber: text('job_number').notNull(),
    status: jobStatusEnum('status').notNull().default('new'),
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

    notes: text('notes'),
    internalNotes: text('internal_notes'),

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

export interface InvoicePartLine {
  partName: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
  amount: string;
}

/**
 * An invoice row exists only once the owner has actually sent/shared it — there
 * is no draft state. Previewing in the Invoicer writes nothing, which is what
 * keeps the invoice number sequence gap-free.
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

    workCarriedOut: text('work_carried_out'),
    labourHours: numeric('labour_hours', { precision: 8, scale: 2 }),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }),

    servicesSubtotal: numeric('services_subtotal', { precision: 12, scale: 2 }).notNull(),
    partsSubtotal: numeric('parts_subtotal', { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull(),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull(),
    totalServices: numeric('total_services', { precision: 12, scale: 2 }).notNull(),
    totalParts: numeric('total_parts', { precision: 12, scale: 2 }).notNull(),
    grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).notNull(),

    parts: jsonb('parts').notNull().$type<InvoicePartLine[]>(),
    otherComments: text('other_comments'),

    pdfStoragePath: text('pdf_storage_path').notNull(),
    sentVia: sentViaEnum('sent_via').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_invoice_number_key').on(table.invoiceNumber),
    index('invoices_job_id_idx').on(table.jobId),
  ],
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

export const invoicesRelations = relations(invoices, ({ one }) => ({
  job: one(jobs, { fields: [invoices.jobId], references: [jobs.id] }),
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
export type Settings = typeof settings.$inferSelect;
