'use client';

import { Mail, MessageCircle, MoreVertical } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

/** Sticks to the bottom of the preview, clearing the home indicator on iOS. */
const STICKY_BAR =
  'sticky bottom-[env(safe-area-inset-bottom,0px)] z-10 border-t border-line bg-surface';

export type SendChannel = 'email' | 'whatsapp' | 'share';

export const SHARE_MESSAGE = 'Please see attached invoice.\n\nNolan Automotive';

export interface FinalizedInvoice {
  blob: Blob;
  invoiceNumber: string;
  invoiceId: string;
  channel: SendChannel;
}

/**
 * Send controls for a generated invoice.
 *
 * Two web-platform constraints shape this, and both are worth knowing before
 * changing anything here:
 *
 *  1. `navigator.share()` must be called SYNCHRONOUSLY inside a user gesture.
 *     Finalising is an awaited fetch, which ends that gesture — so finalise and
 *     share cannot happen on the same tap on iOS Safari. Hence a deliberate two
 *     step flow: first tap commits the invoice, second tap opens the share
 *     sheet. The second tap is a fresh gesture, so it always works.
 *
 *  2. No web API can pre-attach a file to a SPECIFIC WhatsApp conversation. A
 *     `wa.me` link can pre-fill text only. The share sheet can hand over the
 *     actual PDF, but the owner still chooses the contact inside WhatsApp.
 *     Email is therefore the more reliable route and is marked Recommended.
 */
export function SendBar({
  disabled,
  finalized,
  onFinalize,
  pendingChannel,
}: {
  disabled: boolean;
  finalized: FinalizedInvoice | null;
  onFinalize: (channel: SendChannel) => void;
  pendingChannel: SendChannel | null;
}) {
  const [error, setError] = useState<string | null>(null);

  const file = useMemo(() => {
    if (!finalized) return null;
    return new File([finalized.blob], `${finalized.invoiceNumber}.pdf`, {
      type: 'application/pdf',
    });
  }, [finalized]);

  /**
   * Capability detection is a pure query, so it is derived during render rather
   * than synced into state by an effect.
   *
   * It must be checked against the REAL file — whether a browser will share a
   * given payload depends on its MIME type, so a probe with a dummy file lies.
   * The `navigator` guard covers server rendering; no hydration mismatch is
   * possible because this value is only ever read once `finalized` is set,
   * which cannot happen before the owner interacts with the page.
   */
  const canShareFiles = useMemo(() => {
    if (!file || typeof navigator === 'undefined') return false;
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  }, [file]);

  function downloadPdf() {
    if (!finalized) return;

    const url = URL.createObjectURL(finalized.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${finalized.invoiceNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke on the next tick so the download has definitely started.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Second tap. A fresh user gesture, so `navigator.share` is permitted. */
  async function handleSend() {
    if (!finalized || !file) return;
    setError(null);

    if (canShareFiles) {
      try {
        await navigator.share({
          files: [file],
          title: `Invoice ${finalized.invoiceNumber}`,
          text: SHARE_MESSAGE,
        });
        return;
      } catch (shareError) {
        // A user cancelling the sheet throws AbortError; that is not a failure.
        if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
        setError('Sharing failed. The PDF has been downloaded instead — attach it manually.');
        downloadPdf();
        return;
      }
    }

    // Fallback: no file sharing available (typically desktop). Download the PDF
    // and open the relevant app with the message pre-filled; the owner attaches
    // the downloaded file themselves.
    downloadPdf();

    if (finalized.channel === 'email') {
      const subject = encodeURIComponent(`Invoice ${finalized.invoiceNumber} — Nolan Automotive`);
      const body = encodeURIComponent(SHARE_MESSAGE);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    } else if (finalized.channel === 'whatsapp') {
      window.location.href = `https://wa.me/?text=${encodeURIComponent(SHARE_MESSAGE)}`;
    }
  }

  if (finalized) {
    const channelLabel =
      finalized.channel === 'email'
        ? 'email'
        : finalized.channel === 'whatsapp'
          ? 'WhatsApp'
          : 'share sheet';

    return (
      <div className={cn(STICKY_BAR, 'flex flex-col gap-2 p-3')}>
        {error ? <Alert tone="warn">{error}</Alert> : null}

        <Alert tone="ok">
          Invoice <strong>{finalized.invoiceNumber}</strong> created and the job marked as
          Invoiced.
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSend} className="flex-1">
            {canShareFiles
              ? `Share invoice ${finalized.invoiceNumber}`
              : `Download PDF and open ${channelLabel}`}
          </Button>
          <Button variant="secondary" onClick={downloadPdf}>
            Download only
          </Button>
        </div>

        {!canShareFiles ? (
          <p className="text-xs text-muted">
            This browser cannot attach files to a share. The PDF will download and you attach it
            manually — sharing with the file attached works on a phone.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn(STICKY_BAR, 'p-3')}>
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Button
            className="w-full"
            disabled={disabled || pendingChannel !== null}
            onClick={() => onFinalize('email')}
          >
            <Mail aria-hidden className="size-4" />
            {pendingChannel === 'email' ? 'Creating…' : 'Email'}
          </Button>
          <span className="pointer-events-none absolute -top-2 -right-2 rounded-full bg-ok px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            Recommended
          </span>
        </div>

        <Button
          variant="secondary"
          className="flex-1"
          disabled={disabled || pendingChannel !== null}
          onClick={() => onFinalize('whatsapp')}
        >
          <MessageCircle aria-hidden className="size-4" />
          {pendingChannel === 'whatsapp' ? 'Creating…' : 'WhatsApp'}
        </Button>

        <Button
          variant="secondary"
          aria-label="Other sharing options"
          disabled={disabled || pendingChannel !== null}
          onClick={() => onFinalize('share')}
        >
          <MoreVertical aria-hidden className="size-4" />
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted">
        Choosing an option creates the invoice and marks the job as Invoiced. You will then be
        prompted to send it.
      </p>
    </div>
  );
}
