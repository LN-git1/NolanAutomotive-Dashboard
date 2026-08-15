'use client';

import type { ReactNode } from 'react';

import { LogoutButton } from '@/components/layout/logout-button';
import {
  MobileTabBar,
  NavDrawer,
  Sidebar,
  SidebarToggle,
  useSidebarCollapsed,
} from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { cn } from '@/lib/utils';

/**
 * Chrome around every authenticated page.
 *
 * This is a client component only because the grid's first column has to
 * respond to the sidebar being collapsed. `children` is still server-rendered
 * and passed straight through, so no page loses its Server Component nature.
 *
 * Layout by width:
 *  - `lg` and up: a persistent left rail, collapsible to icons via the header.
 *  - below `lg`: a bottom bar with the five most-used pages, plus a Menu drawer
 *    holding everything.
 *
 * `pt-safe` on the header and `pb-navbar` on the main region exist for the
 * installed PWA, which runs standalone with the status bar and home indicator
 * drawing over the page.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const collapsed = useSidebarCollapsed();

  return (
    <div
      className={cn(
        'flex min-h-screen flex-col lg:grid',
        collapsed ? 'lg:grid-cols-[4.5rem_1fr]' : 'lg:grid-cols-[15rem_1fr]',
      )}
    >
      <aside className="lg:sticky lg:top-0 lg:h-screen">
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:static">
          <NavDrawer />
          <SidebarToggle />
          <span className="truncate text-sm font-semibold text-ink lg:hidden">
            Nolan Automotive
          </span>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>

        {/* pb-navbar clears the fixed bottom bar; it is a no-op from lg up. */}
        <main className="pb-navbar min-w-0 flex-1 p-4 lg:p-6 lg:pb-6">{children}</main>
      </div>

      <MobileTabBar />
    </div>
  );
}
