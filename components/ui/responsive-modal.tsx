'use client';

import { type ReactNode, useSyncExternalStore } from 'react';
import { Drawer } from 'vaul';

/** Below Tailwind's `sm` breakpoint: a phone held upright. */
const PHONE_QUERY = '(max-width: 639px)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * True on a phone-width screen. Chosen by width, not by device make, so every
 * phone gets the same behaviour. The server snapshot is `false`: these modals
 * only open after a tap, so nothing is rendered on the server to mismatch.
 */
function useIsPhoneWidth() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * One modal, two looks.
 *
 *  - Phone width: a bottom sheet (vaul) with a drag handle that slides up and
 *    can be swiped down to close.
 *  - Anything wider: the centred pop-up the app has always had, unchanged.
 *
 * `dismissible={false}` is for the one modal that must not be escaped
 * (recording a payment): no swipe, no tap outside, no Escape, on either look.
 * The only way out is a button the caller provides.
 *
 * Callers keep their own header and padding inside `children`, exactly as they
 * had inside the old pop-up, so the wide-screen version is byte-for-byte the
 * old markup. Always mounted with `open`, so closing can animate; callers that
 * unmount it as they close it simply lose the slide-out.
 */
export function ResponsiveModal({
  open,
  onClose,
  label,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  dismissible?: boolean;
  children: ReactNode;
}) {
  const phone = useIsPhoneWidth();

  if (!phone) {
    if (!open) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={dismissible ? onClose : undefined}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <Drawer.Root
      open={open}
      dismissible={dismissible}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content
          aria-describedby={undefined}
          className="pb-safe fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-2xl border border-b-0 border-line bg-surface shadow-lg outline-none"
        >
          <Drawer.Title className="sr-only">{label}</Drawer.Title>
          {dismissible ? (
            <div aria-hidden className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-line" />
          ) : (
            <div className="h-2 shrink-0" />
          )}
          <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
