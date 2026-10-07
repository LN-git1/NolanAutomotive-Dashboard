/** Plain data the digest email is rendered from. No customer personal data lives here. */
export interface DigestData {
  windowStart: Date;
  windowEnd: Date;
  /** Round trip of a `SELECT 1` made while collecting. */
  dbMs: number;
  errors: { at: Date; source: string; label: string; message: string; code: string | null }[];
  jobsCreated: { jobNumber: string; status: string; priority: string; dueDate: string | null; at: Date }[];
  jobsUpdated: { jobNumber: string; status: string; dueDate: string | null; at: Date }[];
  jobsDeleted: { jobNumber: string; at: Date }[];
  invoicesIssued: { invoiceNumber: string; jobNumber: string; amountCents: number; at: Date }[];
  invoicesSent: { invoiceNumber: string; via: string | null; at: Date }[];
  invoicesVoided: { invoiceNumber: string; at: Date }[];
  payments: { invoiceNumber: string; jobNumber: string; amountCents: number; at: Date }[];
  expenses: { category: string; amountCents: number; isCorrection: boolean; at: Date }[];
  supplierEntries: { supplier: string; kind: string; amountCents: number; at: Date }[];
  attachments: { jobNumber: string; count: number }[];
  timeOff: { startDate: string; endDate: string }[];
  snapshot: {
    jobsByStatus: Record<string, number>;
    overdueJobs: number;
    dueSoon: { jobNumber: string; status: string; dueDate: string | null }[];
    outstandingCount: number;
    outstandingCents: number;
    oldestUnpaid: { invoiceNumber: string; issueDate: string } | null;
    collectedTodayCents: number;
    collectedMonthCents: number;
    totalJobs: number;
    totalInvoices: number;
    totalPayments: number;
    totalSuppliers: number;
    dbBytes: number;
    lastActivityAt: Date | null;
  };
}
