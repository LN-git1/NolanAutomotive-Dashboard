import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The complete UI primitive set for this app.
 *
 * Kept deliberately small and dependency-free rather than pulling in a
 * component library: the brief asks for a plain, non-flashy internal tool, and
 * everything here is a styled native element with no client-side JavaScript.
 * That keeps the whole dashboard renderable as Server Components.
 */

/* ---------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-brand';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // `brand-hover` rather than `brand-dark`: the latter is the *text* role and
  // inverts to a light blue in dark mode, which would be unreadable as a fill
  // behind white text.
  primary: 'bg-brand text-white border-brand hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border-line hover:bg-canvas',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-canvas hover:text-ink',
  danger: 'bg-surface text-danger border-line hover:bg-danger-soft',
};

/**
 * Sizes are generous on phones and tighten from `sm` up. This app is used
 * mostly on a phone, often with dirty or gloved hands, so the primary size
 * clears the ~44px touch target guidance on small screens.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs sm:px-2.5 sm:py-1.5',
  md: 'min-h-11 px-4 py-2.5 text-sm sm:min-h-0 sm:px-3.5 sm:py-2',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size]);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

/* ------------------------------------------------------------------ cards */

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/* ------------------------------------------------------------------ forms */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/**
 * `text-base` (16px) on phones is deliberate: iOS Safari zooms the viewport
 * when a focused input is smaller than that, and does not zoom back out.
 * globals.css enforces the same rule for any control rendered outside these
 * components.
 */
const CONTROL_CLASS =
  'w-full rounded-md border border-line bg-surface px-3 py-2.5 text-base text-ink ' +
  'sm:py-2 sm:text-sm ' +
  'placeholder:text-muted/70 focus:border-brand focus:outline-2 focus:outline-offset-0 ' +
  'focus:outline-brand/30 disabled:bg-canvas disabled:text-muted';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL_CLASS, 'min-h-20 resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL_CLASS, 'pr-8', className)} {...props} />;
}

/* ----------------------------------------------------------------- badges */

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-canvas text-muted border-line',
  active: 'bg-info-soft text-brand-dark border-brand/30',
  completed: 'bg-ok-soft text-ok border-ok/30',
  invoiced: 'bg-warn-soft text-warn border-warn/30',
  paid: 'bg-ok-soft text-ok border-ok/40',
  low: 'bg-canvas text-muted border-line',
  medium: 'bg-info-soft text-brand-dark border-brand/30',
  high: 'bg-danger-soft text-danger border-danger/30',
};

export function Badge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
        STATUS_STYLES[value] ?? 'bg-canvas text-muted border-line',
        className,
      )}
    >
      {value}
    </span>
  );
}

/* ------------------------------------------------------------- table bits */

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full min-w-[36rem] border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-line px-3 py-2 text-left text-xs font-semibold text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('border-b border-line px-3 py-2 align-top', className)} {...props} />;
}

/* ------------------------------------------------------------ empty state */

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/* --------------------------------------------------------------- messages */

export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'ok' | 'warn';
  children: ReactNode;
}) {
  const tones = {
    danger: 'border-danger/30 bg-danger-soft text-danger',
    ok: 'border-ok/30 bg-ok-soft text-ok',
    warn: 'border-warn/30 bg-warn-soft text-warn',
  } as const;

  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm', tones[tone])} role="alert">
      {children}
    </div>
  );
}
