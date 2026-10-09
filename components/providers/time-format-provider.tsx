'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
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
  setTimeFormat: (format: TimeFormat) => Promise<void>;
  isPending: boolean;
  formatTime: (value: string | null | undefined) => string | null;
  formatDateTime: (value: Date | string | null | undefined) => string;
  formatDueDateTime: (dueDate: string | null | undefined, dueTime: string | null | undefined) => string;
}

const TimeFormatContext = createContext<TimeFormatContextValue>({
  timeFormat: '12h',
  setTimeFormat: async () => {},
  isPending: false,
  formatTime: (val) => formatTimeFn(val, '12h'),
  formatDateTime: (val) => formatDateTimeFn(val, '12h'),
  formatDueDateTime: (d, t) => formatDueDateTimeFn(d, t, '12h'),
});

export function TimeFormatProvider({
  initialFormat = '12h',
  children,
}: {
  initialFormat?: TimeFormat;
  children: ReactNode;
}) {
  const [timeFormat, setLocalTimeFormat] = useState<TimeFormat>(initialFormat);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function setTimeFormat(next: TimeFormat) {
    setLocalTimeFormat(next);
    startTransition(async () => {
      await updateTimeFormat(next);
      router.refresh();
    });
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
      {children}
    </TimeFormatContext.Provider>
  );
}

export function useTimeFormat() {
  return useContext(TimeFormatContext);
}
