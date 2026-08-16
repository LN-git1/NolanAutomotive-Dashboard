import { toWhatsAppNumber } from './phone';

/**
 * The deep links used to hand an invoice to the customer.
 *
 * Pure and separate from the component on purpose: a `mailto:` is assigned to
 * `window.location.href`, which issues no network request, so a browser test
 * cannot observe it. Building the string here means the part that was actually
 * broken — a missing recipient — is covered by a unit test rather than by
 * eyeballing the UI.
 */

export interface InvoiceRecipient {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  vehicleRegistration: string;
}

/** The covering note. First name only — this is a small garage, not a bank. */
export function buildInvoiceMessage(invoiceNumber: string, recipient: InvoiceRecipient): string {
  const firstName = recipient.customerName.trim().split(/\s+/)[0] || 'there';
  return (
    `Hi ${firstName}, please find invoice ${invoiceNumber} attached for ` +
    `${recipient.vehicleRegistration}.\n\nThanks,\nNolan Automotive`
  );
}

export function buildInvoiceSubject(invoiceNumber: string): string {
  return `Invoice ${invoiceNumber} — Nolan Automotive`;
}

/**
 * `mailto:` addressed to the customer.
 *
 * The bug this replaces was `mailto:?subject=…` — no recipient at all, so the
 * owner retyped the address every time. An absent email still produces a valid
 * link with an empty To field rather than a broken one.
 */
export function buildMailtoHref(invoiceNumber: string, recipient: InvoiceRecipient): string {
  const to = recipient.customerEmail?.trim() ?? '';
  const subject = encodeURIComponent(buildInvoiceSubject(invoiceNumber));
  const body = encodeURIComponent(buildInvoiceMessage(invoiceNumber, recipient));

  // The address goes in the path, unencoded beyond what a mail address allows —
  // encodeURIComponent would escape the @ and break some clients.
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

/**
 * `wa.me` link opening the customer's own chat.
 *
 * Without a number WhatsApp shows a contact picker, which is what it did before.
 * The number must be full international form with no `+`, no spaces and no
 * leading zero — see `lib/phone.ts`. When there is no usable number the link
 * still works and falls back to the picker rather than opening the wrong chat.
 */
export function buildWhatsAppHref(invoiceNumber: string, recipient: InvoiceRecipient): string {
  const number = toWhatsAppNumber(recipient.customerPhone);
  const text = encodeURIComponent(buildInvoiceMessage(invoiceNumber, recipient));
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}
