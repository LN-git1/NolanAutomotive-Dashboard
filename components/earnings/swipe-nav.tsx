'use client';

import { useRouter } from 'next/navigation';
import { useRef, type ReactNode, type TouchEvent } from 'react';

/**
 * A horizontal swipe that navigates to another route. No animation — this app
 * is a plain internal tool, not a marketing site (confirmed: no swipe/gesture
 * code or library existed anywhere in this repo before this).
 *
 * The touch handler bails out if the drag started inside a `<table>`: below
 * `sm` (640px) tables stack into cards with nothing to scroll, but from `sm`
 * up — the tablet-width band, before the desktop chrome even takes over at
 * `lg` (1024px) — a wide table can still scroll sideways, and a page-wide
 * swipe handler would otherwise compete with that drag.
 */
export function SwipeNav({
  to,
  direction,
  children,
}: {
  to: string;
  direction: 'left' | 'right';
  children: ReactNode;
}) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);
  const ignore = useRef(false);

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    ignore.current = (event.target as HTMLElement).closest('table') !== null;
    start.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const origin = start.current;
    start.current = null;
    if (!origin || ignore.current) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;

    // Ignore short or mostly-vertical drags — those are scrolling, not a swipe.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    if (direction === 'left' && dx < 0) router.push(to);
    if (direction === 'right' && dx > 0) router.push(to);
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="touch-pan-y">
      {children}
    </div>
  );
}
