'use client';

import type { ReactNode } from 'react';
import { STATUS_LABEL, formatCalendarDate, formatTimeRange, type DisplayStatus } from '../lib/appointments';
import { DateBlock, Icon, StatusPill, type IconName, type PillTone } from './ui';

export type AppointmentTab = 'upcoming' | 'history';

export function AppointmentTabs({ tab, onChange, upcoming, history }: {
  tab: AppointmentTab;
  onChange: (tab: AppointmentTab) => void;
  upcoming: number;
  history: number;
}) {
  const options: [AppointmentTab, string, number, IconName][] = [
    ['upcoming', 'Próximas', upcoming, 'calendar'],
    ['history', 'Historial', history, 'clock'],
  ];
  return (
    <div role="tablist" aria-label="Citas" className="mb-6 grid w-full grid-cols-2 gap-1.5 rounded-2xl border border-[rgba(54,91,69,0.12)] bg-paper/80 p-1.5 sm:inline-grid sm:w-auto">
      {options.map(([value, label, count, icon]) => (
        <button key={value} id={`tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`}
          onClick={() => onChange(value)}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-ink-soft transition hover:bg-mint hover:text-forest aria-selected:bg-forest aria-selected:text-white aria-selected:shadow-sm">
          <Icon name={icon} size={18} />
          {label}
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs tabular-nums">{count}</span>
        </button>
      ))}
    </div>
  );
}

export const STATUS_TONE: Record<DisplayStatus, PillTone> = {
  SCHEDULED: 'green',
  IN_PROGRESS: 'blue',
  PAST_SCHEDULED: 'amber',
  COMPLETED: 'violet',
  NO_SHOW: 'red',
  CANCELLED: 'gray',
};

export function AppointmentStatusBadge({ status }: { status: DisplayStatus }) {
  return <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>;
}

export function TabPanel({ tab, value, children }: { tab: AppointmentTab; value: AppointmentTab; children: ReactNode }) {
  if (tab !== value) return null;
  return <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`}>{children}</div>;
}

// Shared appointment card: date block, status, date, time and the other person.
export function AppointmentCard({ appointmentDate, startTime, endTime, status, person, personIcon = 'profile', note, children }: {
  appointmentDate: string;
  startTime: string;
  endTime: string;
  status: DisplayStatus;
  person: string;
  personIcon?: IconName;
  note?: ReactNode;
  children?: ReactNode;
}) {
  const highlighted = status === 'PAST_SCHEDULED';
  const faded = status === 'CANCELLED';
  return (
    <li className={`rounded-[22px] border bg-paper p-5 shadow-[var(--shadow-soft)] sm:p-6 ${highlighted ? 'border-amber-300 ring-1 ring-amber-200' : 'border-[rgba(54,91,69,0.13)]'}`}>
      <div className="flex gap-4 sm:gap-6">
        <DateBlock date={appointmentDate} tone={highlighted ? 'amber' : faded ? 'muted' : 'mint'} />
        <div className="min-w-0 flex-1">
          <AppointmentStatusBadge status={status} />
          <h3 className={`mt-2 font-serif text-lg leading-snug first-letter:uppercase sm:text-xl ${faded ? 'text-ink-soft line-through decoration-1' : ''}`}>
            <time dateTime={appointmentDate}>{formatCalendarDate(appointmentDate)}</time>
          </h3>
          <div className="mt-2 flex flex-col gap-1.5 text-sm text-ink-soft sm:flex-row sm:gap-6">
            <span className="inline-flex items-center gap-2 tabular-nums"><Icon name="clock" size={17} className="text-primary" />{formatTimeRange(startTime, endTime)}</span>
            <span className="inline-flex min-w-0 items-center gap-2"><Icon name={personIcon} size={17} className="shrink-0 text-primary" /><span className="break-words">{person}</span></span>
          </div>
          {note && <div className="mt-3 text-sm">{note}</div>}
        </div>
      </div>
      {children && <div className="mt-5 border-t border-[rgba(54,91,69,0.1)] pt-5">{children}</div>}
    </li>
  );
}
