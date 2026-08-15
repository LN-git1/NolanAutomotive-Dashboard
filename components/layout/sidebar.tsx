'use client';

import {
  BanknoteArrowDown,
  FileText,
  LayoutDashboard,
  Menu,
  Settings,
  Truck,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly rather than by prefix — only the root needs this. */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/jobs', label: 'Jobs', icon: Wrench },
  { href: '/invoicer', label: 'Invoicer', icon: FileText },
  { href: '/awaiting-payments', label: 'Awaiting payments', icon: BanknoteArrowDown },
  { href: '/suppliers', label: 'Owed to others', icon: Truck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function useIsActive() {
  const pathname = usePathname();
  return (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useIsActive();

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = isActive(item);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm whitespace-nowrap',
              active
                ? 'bg-info-soft font-medium text-brand-dark'
                : 'text-muted hover:bg-canvas hover:text-ink',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/** Persistent left rail. Only from `lg` up, where there is room to spare. */
export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="hidden h-full flex-col gap-1 border-r border-line bg-surface p-3 lg:flex"
    >
      <div className="px-2 pt-1 pb-4">
        <p className="text-sm font-semibold text-ink">Nolan Automotive</p>
        <p className="text-xs text-muted">Dashboard</p>
      </div>
      <NavLinks />
    </nav>
  );
}

/**
 * Below `lg`, navigation is a drawer rather than anything permanently on
 * screen — a narrow window should give its whole width to the actual work, and
 * navigation is something you reach for occasionally, not something you stare
 * at. The button sits in the header; the drawer closes on selection, on the
 * backdrop, and on Escape.
 *
 * No slide animation: the brief asks for a plain, non-flashy tool, and an
 * instant open is faster to use than one that has to finish moving.
 */
export function NavDrawer() {
  const pathname = usePathname();

  /**
   * Open state is stored as "the path it was opened on", so a navigation closes
   * it by derivation rather than by an effect syncing state after the fact.
   * Covers back/forward too, not just clicking a link.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  // Close on Escape — expected of anything modal. Calls the setter directly
  // rather than the `setOpen` helper so the dependency list stays honest.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedOn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="main-nav-drawer"
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-canvas"
      >
        <Menu aria-hidden className="size-4" />
        Menu
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/40"
          />

          <nav
            id="main-nav-drawer"
            aria-label="Main"
            className="pt-safe pb-safe fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-2 px-2 pt-1 pb-4">
              <div>
                <p className="text-sm font-semibold text-ink">Nolan Automotive</p>
                <p className="text-xs text-muted">Dashboard</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="-mt-1 rounded-md p-2 text-muted hover:bg-canvas hover:text-ink"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>

            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
        </>
      ) : null}
    </div>
  );
}
