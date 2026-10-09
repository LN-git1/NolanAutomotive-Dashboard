'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';
import { pushToast, removeToast, toastTtl, type Toast, type ToastKind } from '@/lib/toast';

/**
 * App-wide toast notifications.
 *
 * Mounted in the root layout so anything with a client boundary can confirm a
 * save or surface a failure — dashboard mutations, the login form, sign-out.
 * The queue logic lives in `lib/toast.ts` (pure and unit-tested); this file is
 * only the wiring: timers, context, and the fixed viewport.
 *
 * Placement: top of the screen, below the status bar on an installed PWA. The
 * dashboard's bottom tab bar and the invoicer's sticky send bar both live at
 * the bottom, so toasts there would sit on top of working controls; the top
 * edge is always clear. `z-[60]` puts them above the header (z-30) and modals
 * (z-50) — a failure while a modal is open must still be visible.
 *
 * Accessibility: each toast is its own live region — `role="alert"` for errors
 * (assertive; they matter), `role="status"` for everything else (polite). The
 * dismiss control is a real button. The reduced-motion rule in globals.css
 * removes the entry animation for anyone who asked for less motion.
 */

interface ToastContextValue {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  dismiss: (id: number) => void;
}

/**
 * A no-op default rather than throwing: a component can render without the
 * provider during a streamed boundary, and losing a toast must never be the
 * reason a page breaks.
 */
const ToastContext = createContext<ToastContextValue>({
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
  dismiss: () => {},
});

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const ICON_CLASSES: Record<ToastKind, string> = {
  success: 'text-ok',
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-brand-dark',
};

const BORDER_CLASSES: Record<ToastKind, string> = {
  success: 'border-ok/40',
  error: 'border-danger/40',
  warning: 'border-warn/40',
  info: 'border-brand/40',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => removeToast(current, id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = (nextId.current += 1);
      setToasts((current) => {
        const { list, dropped } = pushToast(current, { kind, title, message }, id);
        if (dropped) {
          const timer = timers.current.get(dropped.id);
          if (timer) {
            clearTimeout(timer);
            timers.current.delete(dropped.id);
          }
        }
        return list;
      });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), toastTtl(kind)),
      );
    },
    [dismiss],
  );

  // Clear every pending timer when the provider unmounts (full page teardown).
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message),
      warning: (title, message) => push('warning', title, message),
      info: (title, message) => push('info', title, message),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:items-end sm:px-6">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const Icon = ICONS[toast.kind];

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'toast-enter pointer-events-auto w-full max-w-sm rounded-lg border bg-surface shadow-lg',
        BORDER_CLASSES[toast.kind],
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', ICON_CLASSES[toast.kind])} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{toast.title}</p>
          {toast.message ? <p className="mt-0.5 text-xs text-muted">{toast.message}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="-m-1 rounded p-1 text-muted transition-colors hover:text-ink active:bg-canvas"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
