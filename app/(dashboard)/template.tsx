import type { ReactNode } from 'react';

/**
 * Re-mounts on every navigation between dashboard pages (unlike a layout, which
 * persists), which is exactly what lets a CSS enter animation replay per page.
 *
 * The animation itself lives in globals.css under `html[data-apple]`, so on
 * Android and desktop this wrapper is `display: contents` — present in the DOM
 * but invisible to layout and styling, leaving those devices pixel-identical to
 * before. It carries no state and no logic.
 */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
