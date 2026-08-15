import { LogoutButton } from '@/components/layout/logout-button';
import { NavDrawer, Sidebar } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { requireSession } from '@/lib/auth/require-session';

/**
 * Every authenticated page hangs off this layout.
 *
 * `requireSession()` here is deliberate duplication: `proxy.ts` already gates
 * these routes, but if its matcher is ever edited incorrectly this second check
 * keeps customer data from being served to an anonymous request.
 *
 * Layout: a persistent left rail from `lg` up, and below that a drawer opened
 * from the header — a narrow window gives its full width to the work rather
 * than holding navigation on screen permanently.
 *
 * `pt-safe` on the header because the installed PWA runs standalone with a
 * translucent status bar drawing over the page.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  await requireSession();

  return (
    <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="lg:sticky lg:top-0 lg:h-screen">
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:static">
          <NavDrawer />
          <span className="truncate text-sm font-semibold text-ink lg:hidden">
            Nolan Automotive
          </span>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>

        <main className="pb-safe min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
