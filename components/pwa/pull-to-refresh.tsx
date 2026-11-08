'use client';

import { LazyMotion, domAnimation, m } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { isInstalledApp } from '@/lib/client/push';

/** The list pages that can be pulled down to reload. Exact paths only. */
const REFRESHABLE = new Set(['/jobs', '/awaiting-payments', '/schedule', '/suppliers']);

/** How far (in px, after damping) the finger must pull before release reloads. */
const TRIGGER = 64;
const MAX_PULL = 88;

/**
 * Pull the page down from the very top to reload it, like a phone app.
 *
 * Runs only when the dashboard is installed on the Home Screen and only on the
 * list pages above. In a normal browser tab the browser already refreshes on a
 * pull-down, and a second one would fight it. An installed iPhone app has no
 * pull-to-refresh of its own, which is the gap this fills; in an installed
 * Android app the browser's own is switched off while this runs, so both
 * phones behave the same.
 *
 * Reloads with `router.refresh()`, the same refresh every save in the app uses.
 */
export function PullToRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [pending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);

  const enabled = REFRESHABLE.has(pathname);

  useEffect(() => {
    if (!enabled || !isInstalledApp()) return;

    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    // Stops an installed Android app also reloading itself on the same pull.
    root.style.overscrollBehaviorY = 'contain';

    function setPulled(value: number) {
      pullRef.current = value;
      setPull(value);
    }

    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      // Only from the top of the page, and never underneath an open dialog.
      if (!touch || window.scrollY > 0 || document.querySelector('[role="dialog"]')) {
        start.current = null;
        return;
      }
      start.current = { x: touch.clientX, y: touch.clientY };
    }

    function onMove(event: TouchEvent) {
      const origin = start.current;
      const touch = event.touches[0];
      if (!origin || !touch) return;
      const dy = touch.clientY - origin.y;
      const dx = Math.abs(touch.clientX - origin.x);
      // A sideways or upward drag is not a pull.
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        if (pullRef.current !== 0) setPulled(0);
        return;
      }
      setPulled(Math.min(MAX_PULL, dy * 0.5));
    }

    function onEnd() {
      const pulled = pullRef.current;
      start.current = null;
      if (pulled >= TRIGGER) {
        setSpinning(true);
        startTransition(() => {
          router.refresh();
        });
        // Keep the spinner up briefly so a fast refresh still reads as one.
        window.setTimeout(() => setSpinning(false), 700);
      }
      setPulled(0);
    }

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      root.style.overscrollBehaviorY = previousOverscroll;
    };
  }, [enabled, router]);

  const busy = pending || spinning;
  const visible = pull > 0 || busy;
  if (!enabled || !visible) return null;

  const armed = pull >= TRIGGER;
  const offset = busy ? TRIGGER * 0.6 : pull * 0.6;

  return (
    <LazyMotion features={domAnimation}>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <m.div
          animate={{ y: offset, scale: busy || armed ? 1 : 0.85, opacity: busy || pull > 8 ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          className="mt-2 flex size-9 items-center justify-center rounded-full border border-line bg-surface shadow-md"
        >
          <span className="sr-only">{busy ? 'Refreshing' : armed ? 'Release to refresh' : 'Pull to refresh'}</span>
          <m.span
            aria-hidden
            animate={busy ? { rotate: 360 } : { rotate: pull * 3 }}
            transition={busy ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { duration: 0 }}
            className={`size-4 rounded-full border-2 border-t-transparent ${armed || busy ? 'border-brand' : 'border-muted'}`}
          />
        </m.div>
      </div>
    </LazyMotion>
  );
}
