import { describe, expect, it } from 'vitest';

import { buildMailtoHref, buildWhatsAppHref, type InvoiceRecipient } from '@/lib/send-links';

const RECIPIENT: InvoiceRecipient = {
  customerName: 'Margaret O’Sullivan',
  customerEmail: 'margaret@example.ie',
  customerPhone: '087 430 3785',
  vehicleRegistration: '09MN6738',
};

describe('buildMailtoHref', () => {
  it('addresses the customer — the bug was a missing recipient', () => {
    const href = buildMailtoHref('NA-2026-0007', RECIPIENT);
    expect(href.startsWith('mailto:margaret@example.ie?')).toBe(true);
    // The old version produced exactly this, which opens a blank compose.
    expect(href.startsWith('mailto:?')).toBe(false);
  });

  it('pre-fills the subject and the message', () => {
    const href = buildMailtoHref('NA-2026-0007', RECIPIENT);
    expect(decodeURIComponent(href)).toContain('subject=Invoice NA-2026-0007 — Nolan Automotive');
    expect(decodeURIComponent(href)).toContain('Hi Margaret');
    expect(decodeURIComponent(href)).toContain('09MN6738');
  });

  it('leaves the @ intact so mail clients accept it', () => {
    expect(buildMailtoHref('NA-2026-0007', RECIPIENT)).toContain('mailto:margaret@example.ie');
    expect(buildMailtoHref('NA-2026-0007', RECIPIENT)).not.toContain('%40');
  });

  it('still produces a usable link when the job has no email', () => {
    const href = buildMailtoHref('NA-2026-0007', { ...RECIPIENT, customerEmail: null });
    expect(href.startsWith('mailto:?subject=')).toBe(true);
  });

  it('encodes the body so newlines survive', () => {
    const href = buildMailtoHref('NA-2026-0007', RECIPIENT);
    expect(href).toContain('%0A'); // the blank line before the sign-off
  });
});

describe('buildWhatsAppHref', () => {
  it('targets the customer chat with the number internationalised', () => {
    // 087 430 3785 -> 353874303785. Without this it opens a contact picker.
    expect(buildWhatsAppHref('NA-2026-0007', RECIPIENT)).toContain('https://wa.me/353874303785?');
  });

  it('handles a number stored without its leading zero', () => {
    const href = buildWhatsAppHref('NA-2026-0007', { ...RECIPIENT, customerPhone: '832013732' });
    expect(href).toContain('wa.me/353832013732');
  });

  it('pre-fills the message', () => {
    const href = buildWhatsAppHref('NA-2026-0007', RECIPIENT);
    expect(decodeURIComponent(href)).toContain('Hi Margaret');
    expect(decodeURIComponent(href)).toContain('NA-2026-0007');
  });

  it('falls back to the contact picker rather than a wrong number', () => {
    for (const phone of [null, '', 'call the shop']) {
      const href = buildWhatsAppHref('NA-2026-0007', { ...RECIPIENT, customerPhone: phone });
      expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    }
  });
});

describe('the covering note', () => {
  it('uses the first name only', () => {
    const href = buildWhatsAppHref('NA-2026-0007', { ...RECIPIENT, customerName: 'Zach Boyd' });
    expect(decodeURIComponent(href)).toContain('Hi Zach,');
  });

  it('copes with a blank name rather than greeting nobody', () => {
    const href = buildWhatsAppHref('NA-2026-0007', { ...RECIPIENT, customerName: '   ' });
    expect(decodeURIComponent(href)).toContain('Hi there,');
  });
});
