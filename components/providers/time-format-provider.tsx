'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  Suspense,
  use,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { updateTimeFormat } from '@/lib/actions/settings';
import {
  formatDateTime as formatDateTimeFn,
  formatDueDateTime as formatDueDateTimeFn,
  formatTime as formatTimeFn,
  type TimeFormat,
} from '@/lib/format';

interface TimeFormatContextValue {
  timeFormat: TimeFormat;
  setTimeFormat: (format: TimeFormat) => Promise<{ ok: boolean; error?: string }>;
  isPending: boolean;
  formatTime: (value: string | null | undefined) => string | null;
  formatDateTime: (value: Date | string | null | undefined) => string;
  formatDueDateTime: (dueDate: string | null | undefined, dueTime: string | null | undefined) => string;
}

const TimeFormatContext = createContext<TimeFormatContextValue>({
  timeFormat: '12h',
  setTimeFormat: async () => ({ ok: true }),
  isPending: false,
  formatTime: (val) => formatTimeFn(val, '12h'),
  formatDateTime: (val) => formatDateTimeFn(val, '12h'),
  formatDueDateTime: (d, t) => formatDueDateTimeFn(d, t, '12h'),
});

export function TimeFormatProvider({
  initialFormat = '12h',
  formatPromise,
  children,
}: {
  initialFormat?: TimeFormat;
  /**
   * The saved format, passed as a promise so the layout never has to await the
   * database before streaming the shell and skeletons. Synced into state in an
   * isolated Suspense boundary once it lands — never blocking `children`.
   */
  formatPromise?: Promise<TimeFormat>;
  children: ReactNode;
}) {
  const [timeFormat, setLocalTimeFormat] = useState<TimeFormat>(initialFormat);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  // Once the owner has touched the toggle, the server value is stale news —
  // a late-resolving promise must not overwrite their choice.
  const touched = useRef(false);

  const applyServerFormat = useCallback((format: TimeFormat) => {
    if (!touched.current) setLocalTimeFormat(format);
  }, []);

  async function setTimeFormat(next: TimeFormat) {
    touched.current = true;
    const previous = timeFormat;
    setLocalTimeFormat(next);
    try {
      const result = await updateTimeFormat(next);
      if (!result.ok) {
        // The switch already flipped on screen; put it back so the UI never
        // claims a format the database does not have.
        setLocalTimeFormat(previous);
        return result;
      }
      startTransition(() => {
        router.refresh();
      });
      return result;
    } catch {
      setLocalTimeFormat(previous);
      return { ok: false as const, error: 'Could not save the time format.' };
    }
  }

  return (
    <TimeFormatContext.Provider
      value={{
        timeFormat,
        setTimeFormat,
        isPending,
        formatTime: (value) => formatTimeFn(value, timeFormat),
        formatDateTime: (value) => formatDateTimeFn(value, timeFormat),
        formatDueDateTime: (dueDate, dueTime) => formatDueDateTimeFn(dueDate, dueTime, timeFormat),
      }}
    >
      {formatPromise ? (
        <Suspense fallback={null}>
          <FormatApplier promise={formatPromise} apply={applyServerFormat} />
        </Suspense>
      ) : null}
      {children}
    </TimeFormatContext.Provider>
  );
}

/** Unwraps the layout's settings promise without blocking the page. */
function FormatApplier({
  promise,
  apply,
}: {
  promise: Promise<TimeFormat>;
  apply: (format: TimeFormat) => void;
}) {
  const format = use(promise);

  useEffect(() => {
    apply(format);
  }, [format, apply]);

  return null;
}

export function useTimeFormat() {
  return useContext(TimeFormatContext);
}
