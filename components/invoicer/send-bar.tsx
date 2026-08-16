'use client';

import { Mail, MessageCircle, Share2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, Button } from '@/components/ui';
import { toWhatsAppNumber } from '@/lib/phone';
import { cn } from '@/lib/utils';

/**
 * Sticks to the bottom of the preview, clearing the fixed phone bottom bar
 * (4rem plus the home indicator). From `lg` up that bar is gone, so it sits
 * flush at the bottom.
 */
const STICKY_BAR =
  'sticky bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-10 border-t border-line ' +
  'bg-surface lg:bottom-0';

export type SendChannel = 'email' | 'whatsapp' | 'share';

export interface IssuedInvoice {
  blob: Blob;
  invoiceNumber: string;
  invoiceId: string;
}

export interface SendRecipient {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  vehicleRegistration: string;
}

function messageFor(invoiceNumber: string, recipient: SendRecipient) {
  const name = recipient.customerName.split(' ')[0] || 'there';
  return (
    `Hi ${name}, please find invoice ${invoiceNumber} attached for ` +
    `${recipient.vehicleRegistration}.\n\nThanks,\nNolan Automotive`
  );
}

/**
 * Send controls for an invoice that ALREADY EXISTS.
 *
 * The invoice is created when it is generated, so every button here acts on a
 * single tap with nothing to wait for. Previously each one fired a ten-second
 * commit and then demanded a second tap, which is what made sending feel slow.
 *
 * Two web-platform limits still shape what "send" can mean, and both are worth
 * knowing before changing anything:
 *
 *  1. **No web API can attach a file to a mailto: or wa.me link.** Only the
 *     native share sheet can hand over the actual PDF. So Email and WhatsApp
 *     download the PDF and open the app with the recipient and message already
 *     filled in; the owner attaches the file, which is one action rather than
 *     retyping an address and a message.
 *  2. **`navigator.share()` must run synchronously inside a user gesture.** It
 *     does here — nothing is awaited before it, because the invoice already
 *     exists.
 */
export function SendBar({
  invoice,
  recipient,
  onSent,
}: {
  invoice: IssuedInvoice;
  recipient: SendRecipient;
  onSent: (channel: SendChannel) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const file = useMemo(
    () => new File([invoice.blob], `${invoice.invoiceNumber}.pdf`, { type: 'application/pdf' }),
    [invoice],
  );

  /**
   * Whether this browser can share the actual PDF. Checked against the REAL
   * file, because whether a browser will share a payload depends on its MIME
   * type — a probe with a dummy file lies.
   */
  const canShareFiles = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  }, [file]);

  const waNumber = toWhatsAppNumber(recipient.customerPhone);
  const message = messageFor(invoice.invoiceNumber, recipient);

  function downloadPdf() {
    const url = URL.createObjectURL(invoice.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoice.invoiceNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke on a later tick so the download has definitely started.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function handleEmail() {
    setError(null);
    // The PDF cannot ride along in a mailto:, so put it on the device first.
    downloadPdf();

    const to = recipient.customerEmail ?? '';
    const subject = `Invoice ${invoice.invoiceNumber} — Nolan Automotive`;
    const href =
      `mailto:${encodeURIComponent(to)}` +
      `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

    setNote(
      to
        ? `Opening your email app to ${to}. Attach ${invoice.invoiceNumber}.pdf — it has just downloaded.`
        : `This job has no email address, so the To field will be blank. Attach ${invoice.invoiceNumber}.pdf — it has just downloaded.`,
    );

    onSent('email');
    window.location.href = href;
  }

  function handleWhatsApp() {
    setError(null);
    downloadPdf();

    // wa.me needs a full international number with no + or leading zero. Without
    // one it opens a contact picker instead of the customer's chat.
    const href = waNumber
      ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    setNote(
      waNumber
        ? `Opening WhatsApp to ${recipient.customerPhone}. Attach ${invoice.invoiceNumber}.pdf — it has just downloaded.`
        : `This job has no phone number, so WhatsApp will ask you to pick the contact. Attach ${invoice.invoiceNumber}.pdf — it has just downloaded.`,
    );

    onSent('whatsapp');
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  /**
   * The only route that carries the PDF itself. Runs synchronously in the tap,
   * so iOS permits it.
   */
  async function handleShare() {
    setError(null);
    setNote(null);

    if (!canShareFiles) {
      downloadPdf();
      setNote('This browser cannot attach files to a share, so the PDF has downloaded instead.');
      onSent('share');
      return;
    }

    try {
      await navigator.share({
        files: [file],
        title: `Invoice ${invoice.invoiceNumber}`,
        text: message,
      });
      onSent('share');
    } catch (shareError) {
      // Cancelling the sheet throws AbortError; that is not a failure.
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      downloadPdf();
      setError('Sharing failed, so the PDF has downloaded instead — attach it manually.');
    }
  }

  return (
    <div className={cn(STICKY_BAR, 'flex flex-col gap-2 p-3')}>
      {error ? <Alert tone="warn">{error}</Alert> : null}
      {note && !error ? <Alert tone="ok">{note}</Alert> : null}

      {!error && !note ? (
        <Alert tone="ok">
          Invoice <strong>{invoice.invoiceNumber}</strong> is ready. Send it below.
        </Alert>
      ) : null}

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Button className="w-full" onClick={handleEmail}>
            <Mail aria-hidden className="size-4" />
            Email
          </Button>
          <span className="pointer-events-none absolute -top-2 -right-2 rounded-full bg-ok px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            Recommended
          </span>
        </div>

        <Button variant="secondary" className="flex-1" onClick={handleWhatsApp}>
          <MessageCircle aria-hidden className="size-4" />
          WhatsApp
        </Button>

        {/* The share sheet is the one path that attaches the PDF for you. */}
        <Button
          variant="secondary"
          aria-label={canShareFiles ? 'Share the invoice with the PDF attached' : 'Download the PDF'}
          onClick={() => void handleShare()}
        >
          <Share2 aria-hidden className="size-4" />
        </Button>
      </div>

      <p className="text-xs text-muted">
        {canShareFiles
          ? 'Email and WhatsApp open with the customer and message filled in — attach the downloaded PDF. The share button sends the PDF itself.'
          : 'Email and WhatsApp open with the customer and message filled in. The PDF downloads so you can attach it.'}
      </p>
    </div>
  );
}
