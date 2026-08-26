'use client';

import {
  BanknoteArrowDown,
  BanknoteArrowUp,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Truck,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  /** Short form for the bottom bar, where five labels share the screen width. */
  shortLabel: string;
  icon: LucideIcon;
  /** Match the path exactly rather than by prefix — only the root needs this. */
  exact?: boolean;
  /** Also gets a permanent slot in the phone bottom bar. */
  primary?: boolean;
}

/**
 * Ordered as the work actually moves, not by how often each page is opened.
 *
 * Jobs, Invoiced jobs and Paid jobs are the three stages of one pipeline — a
 * job leaves each for the next as it is billed and then paid — so they sit
 * together, in that order, directly under Overview. They were previously split
 * by Schedule and Invoicer, which put two unrelated pages in the middle of a
 * sequence and made the three lists read as three separate features rather
 * than one journey. Schedule and Invoicer follow as the tools used against
 * that pipeline, then the two standalone pages.
 *
 * Only the five marked `primary` also get a slot in the phone bottom bar — the
 * things touched between jobs. Invoiced jobs, Paid jobs and Owed to others are
 * money reviews rather than day-to-day actions, so they stay one tap away in
 * the menu. Paid jobs in particular is a lookup ("what did we charge them in
 * March?"), not somewhere the owner works from, and the bottom bar has no
 * sixth slot that would not crush the other five.
 *
 * Note that this ordering leaves the bottom bar untouched: the two pages that
 * moved up are both non-primary, so `PRIMARY_ITEMS` still resolves to the same
 * five in the same order.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard, exact: true, primary: true },
  { href: '/jobs', label: 'Jobs', shortLabel: 'Jobs', icon: Wrench, primary: true },
  { href: '/awaiting-payments', label: 'Invoiced jobs', shortLabel: 'Invoiced', icon: BanknoteArrowDown },
  { href: '/paid-jobs', label: 'Paid jobs', shortLabel: 'Paid', icon: BanknoteArrowUp },
  { href: '/schedule', label: 'Schedule', shortLabel: 'Schedule', icon: CalendarDays, primary: true },
  { href: '/invoicer', label: 'Invoicer', shortLabel: 'Invoicer', icon: FileText, primary: true },
  { href: '/suppliers', label: 'Owed to others', shortLabel: 'Suppliers', icon: Truck },
  { href: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings, primary: true },
];

const PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.primary);

const COLLAPSE_KEY = 'nolan-sidebar-collapsed';

/* ------------------------------------------------ collapsed state (desktop) */

let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The server cannot know the stored preference; hydration corrects it. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Stored outside React so the rail and its toggle button — which live in
 * different parts of the tree — stay in step without threading props or a
 * context through a server-rendered layout.
 */
export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function toggleSidebarCollapsed() {
  const next = !getSnapshot();
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  } catch {
    // Private browsing can refuse storage; the toggle still works for this view.
  }
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ shared */

function useIsActive() {
  const pathname = usePathname();
  return (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({
  onNavigate,
  iconsOnly = false,
}: {
  onNavigate?: () => void;
  iconsOnly?: boolean;
}) {
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
            title={iconsOnly ? item.label : undefined}
            className={cn(
              'flex shrink-0 items-center rounded-md text-sm whitespace-nowrap',
              iconsOnly ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5',
              active
                ? 'bg-info-soft font-medium text-brand-dark'
                : 'text-muted hover:bg-canvas hover:text-ink',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {iconsOnly ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------- desktop left rail */

/** Persistent rail with every page. Collapses to icons via the header button. */
export function Sidebar() {
  const collapsed = useSidebarCollapsed();

  return (
    <nav
      aria-label="Main"
      className="hidden h-full flex-col gap-1 border-r border-line bg-surface p-3 lg:flex"
    >
      <div className={cn('pt-1 pb-4', collapsed ? 'px-0 text-center' : 'px-2')}>
        {collapsed ? (
          <p className="text-sm font-semibold text-ink">NA</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-ink">Nolan Automotive</p>
            <p className="text-xs text-muted">Dashboard</p>
          </>
        )}
      </div>
      <NavLinks iconsOnly={collapsed} />
    </nav>
  );
}

/** Collapse/expand control for the rail. Desktop only — phones use the drawer. */
export function SidebarToggle() {
  const collapsed = useSidebarCollapsed();

  return (
    <button
      type="button"
      onClick={toggleSidebarCollapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="hidden rounded-md border border-line bg-surface p-2 text-muted hover:bg-canvas hover:text-ink lg:inline-flex"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden className="size-4" />
      ) : (
        <PanelLeftClose aria-hidden className="size-4" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------ mobile drawer */

/**
 * The full menu, opened from the header below `lg`. This is where every page is
 * reachable, including the three the bottom bar has no room for. Closes on
 * selection, on the backdrop, and on Escape.
 *
 * No slide animation: the brief asks for a plain, non-flashy tool, and an
 * instant open is quicker to use than one that has to finish moving.
 */
export function NavDrawer() {
  const pathname = usePathname();

  /**
   * Open state is stored as "the path it was opened on", so a navigation closes
   * it by derivation rather than an effect resetting state afterwards. That
   * covers back/forward too, not just clicking a link.
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
        /* Size is pinned rather than left to padding. It sits in a compact
           header beside the theme and sign-out controls, and the 44px touch
           target it used to carry made it visibly taller than both. 34x86 keeps
           it level with its neighbours while staying wide enough to hit easily. */
        className="inline-flex h-[34px] w-[86px] items-center justify-center gap-2 rounded-md border border-line bg-surface text-sm text-ink hover:bg-canvas"
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
            aria-label="All pages"
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

/* --------------------------------------------------------- phone bottom bar */

/**
 * The five things reached between jobs, within thumb reach. Fixed rather than
 * sticky so it survives the iOS URL bar collapsing, and padded for the home
 * indicator when installed to the home screen. Everything else is in the menu.
 */
export function MobileTabBar() {
  const isActive = useIsActive();

  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden"
    >
      <ul className="flex">
        {PRIMARY_ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] leading-none',
                  active ? 'font-semibold text-brand-dark' : 'text-muted',
                )}
              >
                <Icon aria-hidden className={cn('size-5', active && 'stroke-[2.5]')} />
                <span className="w-full truncate text-center">{item.shortLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
