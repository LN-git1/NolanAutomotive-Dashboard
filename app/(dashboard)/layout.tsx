import { LogoutButton } from '@/components/layout/logout-button';
import { Sidebar } from '@/components/layout/sidebar';
import { requireSession } from '@/lib/auth/require-session';

/**
 * Every authenticated page hangs off this layout.
 *
 * `requireSession()` here is deliberate duplication: `middleware.ts` already
 * gates these routes, but if its matcher is ever edited incorrectly this second
 * check keeps customer data from being served to an anonymous request.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  await requireSession();

  return (
    <div className="flex min-h-screen flex-col md:grid md:grid-cols-[15rem_1fr]">
      <aside className="md:sticky md:top-0 md:h-screen">
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-line bg-surface px-4 py-2">
          <LogoutButton />
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
