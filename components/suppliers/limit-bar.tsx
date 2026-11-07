import { limitProgress, type LimitTone } from '@/lib/supplier-limit-progress';

const FILL: Record<LimitTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-orange-500',
  over: 'bg-danger',
};

/**
 * A thin progress bar showing how much of a supplier's rough limit is used,
 * with the percentage at the end. Green below 80%, orange from 80%, red at or
 * past the limit. A limit never blocks anything, so going over is shown
 * (`112%`, red) and nothing more.
 *
 * Draws nothing when the supplier has no limit. Server-safe: no state.
 */
export function SupplierLimitBar({
  balanceCents,
  limitCents,
  className,
}: {
  balanceCents: number;
  limitCents: number | null;
  className?: string;
}) {
  const progress = limitProgress(balanceCents, limitCents);
  if (!progress) return null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <div
        role="progressbar"
        aria-label="Share of the limit used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, progress.percent)}
        aria-valuetext={`${progress.percent}% of the limit`}
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full transition-[width] ${FILL[progress.tone]}`}
          style={{ width: `${progress.fillPercent}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-medium text-muted tabular">
        {progress.percent}%
      </span>
    </div>
  );
}
