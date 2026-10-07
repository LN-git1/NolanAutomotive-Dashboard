import { formatEur } from '@/lib/money';

import type { DigestData } from './types';

const TZ = 'Europe/Dublin';

const C = {
  bg: '#f4f5f7',
  card: '#ffffff',
  ink: '#1a1d23',
  muted: '#6b7280',
  line: '#e5e7eb',
  good: '#15803d',
  goodBg: '#ecfdf3',
  bad: '#b91c1c',
  badBg: '#fef2f2',
  warn: '#b45309',
  warnBg: '#fffbeb',
  accent: '#1d4ed8',
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const timeFmt = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, day: 'numeric', month: 'short' });

const hhmm = (d: Date) => timeFmt.format(d);

function isoDay(value: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} kB`;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Work done',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

function windowLabel(data: Pick<DigestData, 'windowStart' | 'windowEnd'>): string {
  return `${dayFmt.format(data.windowEnd)}, ${hhmm(data.windowStart)}–${hhmm(data.windowEnd)}`;
}

function tile(label: string, value: string, tone: 'neutral' | 'bad' | 'good' = 'neutral'): string {
  const colour = tone === 'bad' ? C.bad : tone === 'good' ? C.good : C.ink;
  return `<td width="33%" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:10px;"><tr><td style="padding:12px 14px;"><div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};">${esc(label)}</div><div style="font-size:24px;font-weight:700;color:${colour};margin-top:2px;">${esc(value)}</div></td></tr></table></td>`;
}

function section(title: string, count: number | null, body: string): string {
  const badge =
    count === null
      ? ''
      : `<span style="font-size:12px;font-weight:600;color:${C.muted};background:${C.bg};border-radius:999px;padding:2px 9px;margin-left:8px;">${count}</span>`;
  return `<tr><td style="padding:14px 6px 0 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:10px;"><tr><td style="padding:14px 16px 4px 16px;font-size:15px;font-weight:700;color:${C.ink};">${esc(title)}${badge}</td></tr><tr><td style="padding:4px 16px 14px 16px;">${body}</td></tr></table></td></tr>`;
}

function table(headers: string[], rows: string[][], rightAlign: number[] = []): string {
  const th = headers
    .map(
      (h, i) =>
        `<th align="${rightAlign.includes(i) ? 'right' : 'left'}" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${C.muted};font-weight:600;padding:6px 8px 6px 0;border-bottom:1px solid ${C.line};">${esc(h)}</th>`,
    )
    .join('');
  const tr = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (cell, i) =>
              `<td align="${rightAlign.includes(i) ? 'right' : 'left'}" style="font-size:13px;color:${C.ink};padding:7px 8px 7px 0;border-bottom:1px solid ${C.bg};vertical-align:top;">${cell}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${tr}</table>`;
}

const empty = (text: string) => `<div style="font-size:13px;color:${C.muted};padding:6px 0;">${esc(text)}</div>`;
const mono = (v: string) => `<span style="font-family:Consolas,Menlo,monospace;font-weight:600;">${esc(v)}</span>`;
const pill = (text: string, fg: string, bg: string) =>
  `<span style="font-size:11px;font-weight:600;color:${fg};background:${bg};border-radius:999px;padding:2px 8px;">${esc(text)}</span>`;

function shell(title: string, banner: string, inner: string, footer: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head><body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:20px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">${banner}${inner}<tr><td style="padding:18px 6px 6px 6px;font-size:11px;color:${C.muted};line-height:1.5;">${footer}</td></tr></table></td></tr></table></body></html>`;
}

function header(data: Pick<DigestData, 'windowStart' | 'windowEnd'>, status: { text: string; fg: string; bg: string }): string {
  return `<tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:10px;"><tr><td style="padding:18px 18px 6px 18px;"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.accent};font-weight:700;">Nolan Automotive · Dashboard digest</div><div style="font-size:22px;font-weight:700;color:${C.ink};margin-top:4px;">${esc(windowLabel(data))}</div><div style="font-size:12px;color:${C.muted};margin-top:2px;">Last 3 hours · Dublin time</div></td></tr><tr><td style="padding:10px 18px 18px 18px;"><div style="display:inline-block;font-size:13px;font-weight:700;color:${status.fg};background:${status.bg};border-radius:8px;padding:8px 12px;">${esc(status.text)}</div></td></tr></table></td></tr>`;
}

export function renderDigest(data: DigestData): RenderedDigest {
  const s = data.snapshot;
  const errorCount = data.errors.length;
  const moneyInCents = data.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const jobsTouched = data.jobsCreated.length + data.jobsUpdated.length;
  const activityCount =
    jobsTouched + data.jobsDeleted.length + data.invoicesIssued.length + data.invoicesSent.length +
    data.invoicesVoided.length + data.payments.length + data.expenses.length +
    data.supplierEntries.length + data.attachments.length + data.timeOff.length;

  const slow = data.dbMs > 2000;
  const status =
    errorCount > 0
      ? { text: `${errorCount} error${errorCount === 1 ? '' : 's'} in this window`, fg: C.bad, bg: C.badBg }
      : slow
        ? { text: `No errors, but the database was slow (${data.dbMs} ms)`, fg: C.warn, bg: C.warnBg }
        : { text: 'All healthy — no errors', fg: C.good, bg: C.goodBg };

  /* ------------------------------------------------------------- tiles */
  const tiles =
    `<tr><td style="padding:8px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    tile('Errors', String(errorCount), errorCount > 0 ? 'bad' : 'good') +
    tile('Jobs added', String(data.jobsCreated.length)) +
    tile('Jobs updated', String(data.jobsUpdated.length)) +
    `</tr><tr>` +
    tile('Invoices issued', String(data.invoicesIssued.length)) +
    tile('Money in', formatEur(moneyInCents), moneyInCents > 0 ? 'good' : 'neutral') +
    tile('Expenses logged', String(data.expenses.length)) +
    `</tr></table></td></tr>`;

  /* ------------------------------------------------------------ errors */
  const grouped = new Map<string, { n: number; last: Date; message: string; source: string }>();
  for (const e of data.errors) {
    const key = `${e.source}|${e.label}`;
    const g = grouped.get(key);
    if (g) g.n += 1;
    else grouped.set(key, { n: 1, last: e.at, message: e.message, source: e.source });
  }
  const errorsBody = errorCount
    ? table(
        ['Time', 'Where', 'Message'],
        data.errors.slice(0, 40).map((e) => [
          esc(hhmm(e.at)),
          `${pill(e.source, C.bad, C.badBg)}<div style="margin-top:3px;">${mono(e.label.slice(0, 60))}</div>`,
          `<div style="color:${C.bad};">${esc(e.message.slice(0, 220))}</div>${e.code ? `<div style="color:${C.muted};font-size:11px;">code ${esc(e.code)}</div>` : ''}`,
        ]),
      ) +
      (grouped.size > 1
        ? `<div style="font-size:12px;color:${C.muted};padding-top:8px;">By source: ${[...grouped.entries()]
            .map(([k, g]) => `${esc(k.split('|')[1]!.slice(0, 40))} ×${g.n}`)
            .join(' · ')}</div>`
        : '') +
      (errorCount > 40 ? `<div style="font-size:12px;color:${C.muted};padding-top:6px;">…and ${errorCount - 40} more.</div>` : '')
    : empty('No errors recorded in this window.');

  /* -------------------------------------------------------------- jobs */
  const jobsAddedBody = data.jobsCreated.length
    ? table(
        ['Job', 'Status', 'Due', 'Added'],
        data.jobsCreated.map((j) => [mono(j.jobNumber), esc(STATUS_LABEL[j.status] ?? j.status), esc(isoDay(j.dueDate)), esc(hhmm(j.at))]),
      )
    : empty('No jobs added.');
  const jobsUpdatedBody = data.jobsUpdated.length
    ? table(
        ['Job', 'Status now', 'Due', 'Updated'],
        data.jobsUpdated.map((j) => [mono(j.jobNumber), esc(STATUS_LABEL[j.status] ?? j.status), esc(isoDay(j.dueDate)), esc(hhmm(j.at))]),
      )
    : empty('No existing jobs updated.');
  const deletedBody = data.jobsDeleted.length
    ? table(['Job', 'Deleted'], data.jobsDeleted.map((j) => [mono(j.jobNumber), esc(hhmm(j.at))]))
    : '';

  /* ---------------------------------------------------------- invoices */
  const invoiceRows: string[][] = [
    ...data.invoicesIssued.map((i) => [esc(hhmm(i.at)), pill('Issued', C.accent, '#eff6ff'), mono(i.invoiceNumber), `${esc(i.jobNumber)} · ${esc(formatEur(i.amountCents))}`]),
    ...data.invoicesSent.map((i) => [esc(hhmm(i.at)), pill('Sent', C.good, C.goodBg), mono(i.invoiceNumber), esc(i.via ? `via ${i.via}` : '')]),
    ...data.invoicesVoided.map((i) => [esc(hhmm(i.at)), pill('Voided', C.bad, C.badBg), mono(i.invoiceNumber), '']),
  ];
  const invoicesBody = invoiceRows.length ? table(['Time', 'Event', 'Invoice', 'Detail'], invoiceRows) : empty('No invoice activity.');

  const paymentsBody = data.payments.length
    ? table(
        ['Time', 'Invoice', 'Job', 'Amount'],
        data.payments.map((p) => [esc(hhmm(p.at)), mono(p.invoiceNumber), esc(p.jobNumber), `<strong>${esc(formatEur(p.amountCents))}</strong>`]),
        [3],
      ) + `<div style="font-size:13px;padding-top:8px;color:${C.ink};">Total received: <strong>${esc(formatEur(moneyInCents))}</strong></div>`
    : empty('No payments received.');

  /* ------------------------------------------------- books & suppliers */
  const expensesBody = data.expenses.length
    ? table(
        ['Time', 'Category', 'Amount'],
        data.expenses.map((e) => [esc(hhmm(e.at)), `${esc(e.category)}${e.isCorrection ? ` ${pill('correction', C.warn, C.warnBg)}` : ''}`, esc(formatEur(e.amountCents))]),
        [2],
      )
    : empty('No expenses logged.');
  const supplierBody = data.supplierEntries.length
    ? table(
        ['Time', 'Supplier', 'Entry', 'Amount'],
        data.supplierEntries.map((x) => [esc(hhmm(x.at)), esc(x.supplier), esc(x.kind), esc(formatEur(x.amountCents))]),
        [3],
      )
    : empty('No supplier activity.');

  /* ------------------------------------------------------- other bits */
  const otherParts: string[] = [];
  if (data.attachments.length) {
    otherParts.push(
      `${data.attachments.reduce((n, a) => n + a.count, 0)} attachment(s) uploaded to ${data.attachments.map((a) => esc(a.jobNumber)).join(', ')}`,
    );
  }
  if (data.timeOff.length) {
    otherParts.push(`Time off booked: ${data.timeOff.map((t) => `${esc(isoDay(t.startDate))}–${esc(isoDay(t.endDate))}`).join(', ')}`);
  }
  const otherBody = otherParts.length
    ? `<ul style="margin:6px 0;padding-left:18px;font-size:13px;color:${C.ink};">${otherParts.map((p) => `<li style="margin:3px 0;">${p}</li>`).join('')}</ul>`
    : empty('Nothing else.');

  /* ---------------------------------------------------------- snapshot */
  const statusRow = ['active', 'completed', 'invoiced', 'paid']
    .map((k) => `<td align="center" style="padding:6px 4px;"><div style="font-size:20px;font-weight:700;color:${C.ink};">${s.jobsByStatus[k] ?? 0}</div><div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:.04em;">${esc(STATUS_LABEL[k]!)}</div></td>`)
    .join('');
  const snapshotBody =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${statusRow}</tr></table>` +
    `<div style="height:8px"></div>` +
    table(
      ['Right now', ''],
      [
        ['Outstanding (unpaid invoices)', `<strong>${esc(formatEur(s.outstandingCents))}</strong> across ${s.outstandingCount} invoice${s.outstandingCount === 1 ? '' : 's'}`],
        ['Oldest unpaid', s.oldestUnpaid ? `${mono(s.oldestUnpaid.invoiceNumber)} · issued ${esc(isoDay(s.oldestUnpaid.issueDate))}` : 'None'],
        ['Received today', esc(formatEur(s.collectedTodayCents))],
        ['Received this month', esc(formatEur(s.collectedMonthCents))],
        ['Overdue jobs (past due, not invoiced)', s.overdueJobs > 0 ? `<strong style="color:${C.warn};">${s.overdueJobs}</strong>` : '0'],
      ],
    );

  const dueSoonBody = s.dueSoon.length
    ? table(['Job', 'Due', 'Status'], s.dueSoon.map((j) => [mono(j.jobNumber), esc(isoDay(j.dueDate)), esc(STATUS_LABEL[j.status] ?? j.status)]))
    : empty('Nothing due in the next 48 hours.');

  const healthBody = table(
    ['System', ''],
    [
      ['Database round trip', `${esc(`${data.dbMs} ms`)} ${data.dbMs > 2000 ? pill('slow', C.warn, C.warnBg) : pill('ok', C.good, C.goodBg)}`],
      ['Database size', esc(bytes(s.dbBytes))],
      ['Records', esc(`${s.totalJobs} jobs · ${s.totalInvoices} live invoices · ${s.totalPayments} payments · ${s.totalSuppliers} suppliers`)],
      ['Last change in the app', s.lastActivityAt ? esc(`${dayFmt.format(s.lastActivityAt)}, ${hhmm(s.lastActivityAt)}`) : '—'],
    ],
  );

  const quiet =
    activityCount === 0 && errorCount === 0
      ? section('Quiet window', null, empty('Nothing was added, changed, invoiced or paid in these three hours.'))
      : '';

  const inner =
    tiles +
    quiet +
    section('Errors', errorCount, errorsBody) +
    section('Jobs added', data.jobsCreated.length, jobsAddedBody) +
    section('Jobs updated', data.jobsUpdated.length, jobsUpdatedBody + (deletedBody ? `<div style="font-size:12px;color:${C.muted};padding:10px 0 2px;">Deleted</div>${deletedBody}` : '')) +
    section('Invoices', invoiceRows.length, invoicesBody) +
    section('Payments', data.payments.length, paymentsBody) +
    section('Expenses', data.expenses.length, expensesBody) +
    section('Supplier ledger', data.supplierEntries.length, supplierBody) +
    section('Other activity', null, otherBody) +
    section('Business snapshot', null, snapshotBody) +
    section('Due in the next 48 hours', s.dueSoon.length, dueSoonBody) +
    section('System health', null, healthBody);

  const footer = `Generated ${esc(dayFmt.format(data.windowEnd))} ${esc(hhmm(data.windowEnd))} Dublin time. Sent every 3 hours by the Nolan Automotive dashboard.<br>No customer names, contact details or registrations are included in this email.`;

  const subject =
    `Nolan dashboard · ${hhmm(data.windowStart)}–${hhmm(data.windowEnd)} · ` +
    (errorCount > 0 ? `⚠ ${errorCount} error${errorCount === 1 ? '' : 's'} · ` : 'no errors · ') +
    `${data.jobsCreated.length} jobs added` +
    (moneyInCents > 0 ? ` · ${formatEur(moneyInCents)} in` : '');

  /* -------------------------------------------------------- plain text */
  const lines: string[] = [
    `NOLAN AUTOMOTIVE — DASHBOARD DIGEST`,
    windowLabel(data) + ' (Dublin time)',
    status.text.toUpperCase(),
    '',
    `Errors: ${errorCount} | Jobs added: ${data.jobsCreated.length} | Jobs updated: ${data.jobsUpdated.length} | Invoices issued: ${data.invoicesIssued.length} | Money in: ${formatEur(moneyInCents)} | Expenses: ${data.expenses.length}`,
    '',
    `ERRORS (${errorCount})`,
    ...(errorCount ? data.errors.slice(0, 40).map((e) => `  ${hhmm(e.at)}  [${e.source}] ${e.label} — ${e.message.slice(0, 200)}`) : ['  none']),
    '',
    `JOBS ADDED (${data.jobsCreated.length})`,
    ...(data.jobsCreated.length ? data.jobsCreated.map((j) => `  ${hhmm(j.at)}  ${j.jobNumber}  ${STATUS_LABEL[j.status] ?? j.status}  due ${isoDay(j.dueDate)}`) : ['  none']),
    `JOBS UPDATED (${data.jobsUpdated.length})`,
    ...(data.jobsUpdated.length ? data.jobsUpdated.map((j) => `  ${hhmm(j.at)}  ${j.jobNumber}  now ${STATUS_LABEL[j.status] ?? j.status}`) : ['  none']),
    ...(data.jobsDeleted.length ? [`JOBS DELETED (${data.jobsDeleted.length})`, ...data.jobsDeleted.map((j) => `  ${hhmm(j.at)}  ${j.jobNumber}`)] : []),
    '',
    `INVOICES: ${data.invoicesIssued.length} issued, ${data.invoicesSent.length} sent, ${data.invoicesVoided.length} voided`,
    ...data.invoicesIssued.map((i) => `  ${hhmm(i.at)}  issued ${i.invoiceNumber} (${i.jobNumber}) ${formatEur(i.amountCents)}`),
    ...data.invoicesSent.map((i) => `  ${hhmm(i.at)}  sent ${i.invoiceNumber}${i.via ? ` via ${i.via}` : ''}`),
    ...data.invoicesVoided.map((i) => `  ${hhmm(i.at)}  voided ${i.invoiceNumber}`),
    `PAYMENTS (${data.payments.length}) total ${formatEur(moneyInCents)}`,
    ...data.payments.map((p) => `  ${hhmm(p.at)}  ${p.invoiceNumber} (${p.jobNumber}) ${formatEur(p.amountCents)}`),
    `EXPENSES (${data.expenses.length})`,
    ...data.expenses.map((e) => `  ${hhmm(e.at)}  ${e.category}${e.isCorrection ? ' (correction)' : ''} ${formatEur(e.amountCents)}`),
    `SUPPLIER LEDGER (${data.supplierEntries.length})`,
    ...data.supplierEntries.map((x) => `  ${hhmm(x.at)}  ${x.supplier} ${x.kind} ${formatEur(x.amountCents)}`),
    ...otherParts.map((p) => `  ${p.replace(/&amp;/g, '&')}`),
    '',
    'SNAPSHOT',
    `  Jobs: ${['active', 'completed', 'invoiced', 'paid'].map((k) => `${STATUS_LABEL[k]} ${s.jobsByStatus[k] ?? 0}`).join(', ')}`,
    `  Outstanding: ${formatEur(s.outstandingCents)} across ${s.outstandingCount} invoice(s)${s.oldestUnpaid ? `; oldest ${s.oldestUnpaid.invoiceNumber} issued ${isoDay(s.oldestUnpaid.issueDate)}` : ''}`,
    `  Received today ${formatEur(s.collectedTodayCents)}, this month ${formatEur(s.collectedMonthCents)}`,
    `  Overdue jobs: ${s.overdueJobs}; due in 48h: ${s.dueSoon.map((j) => j.jobNumber).join(', ') || 'none'}`,
    '',
    `SYSTEM: database ${data.dbMs} ms, ${bytes(s.dbBytes)}; ${s.totalJobs} jobs, ${s.totalInvoices} live invoices, ${s.totalPayments} payments`,
    '',
    'No customer names, contact details or registrations are included in this email.',
  ];

  return { subject, html: shell(subject, header(data, status), inner, footer), text: lines.join('\n') };
}

/** Sent instead of the full digest when the database cannot be read at all. */
export function renderDigestDbDown(
  window: { windowStart: Date; windowEnd: Date },
  errorMessage: string,
): RenderedDigest {
  const subject = `Nolan dashboard · ${hhmm(window.windowStart)}–${hhmm(window.windowEnd)} · ⚠ database unreachable`;
  const inner = section(
    'The digest could not read the database',
    null,
    `<div style="font-size:13px;color:${C.bad};padding:6px 0;">${esc(errorMessage.slice(0, 400))}</div><div style="font-size:13px;color:${C.ink};padding:6px 0;">Jobs, payments and errors for this window could not be collected. Check Vercel Runtime Logs for <code>[db]</code> lines and the Supabase dashboard.</div>`,
  );
  return {
    subject,
    html: shell(subject, header(window, { text: 'Database unreachable', fg: C.bad, bg: C.badBg }), inner, 'Sent by the Nolan Automotive dashboard digest.'),
    text: `${subject}\n\nThe digest could not read the database: ${errorMessage.slice(0, 400)}\nCheck Vercel Runtime Logs for [db] lines and the Supabase dashboard.`,
  };
}
