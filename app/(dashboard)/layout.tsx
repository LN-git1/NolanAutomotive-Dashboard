import { LogoutButton } from '@/components/layout/logout-button';
import { MobileNav, Sidebar } from '@/components/layout/sidebar';
import { requireSession } from '@/lib/auth/require-session';

/**
 * Every authenticated page hangs off this layout.
 *
 * `requireSession()` here is deliberate duplication: `proxy.ts` already gates
 * these routes, but if its matcher is ever edited incorrectly this second check
 * keeps customer data from being served to an anonymous request.
 *
 * Layout shape: a left rail from `md` up, a fixed bottom tab bar below it. The
 * header carries `pt-safe` because the app runs standalone from the home screen
 * with a translucent status bar drawing over the page.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  await requireSession();

  return (
    <div className="flex min-h-screen flex-col md:grid md:grid-cols-[15rem_1fr]">
      <aside className="md:sticky md:top-0 md:h-screen">
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:static">
          <span className="text-sm font-semibold text-ink md:hidden">Nolan Automotive</span>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </header>

        {/* pb-navbar clears the fixed mobile tab bar; it is a no-op from md up. */}
        <main className="pb-navbar min-w-0 flex-1 p-4 md:p-6 md:pb-6">{children}</main>
      </div>

      <MobileNav />
    </div>
  );
}
