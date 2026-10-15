'use client';

import type { ReactNode } from 'react';
import { STATUS_LABEL, STATUS_STYLE, type DisplayStatus } from '../lib/appointments';

export type AppointmentTab = 'upcoming' | 'history';

export function AppointmentTabs({ tab, onChange, upcoming, history }: {
  tab: AppointmentTab;
  onChange: (tab: AppointmentTab) => void;
  upcoming: number;
  history: number;
}) {
  const options: [AppointmentTab, string, number][] = [['upcoming', 'Próximas', upcoming], ['history', 'Historial', history]];
  return (
    <div role="tablist" aria-label="Citas" className="mb-5 inline-flex w-full rounded-xl border border-border bg-card p-1 sm:w-auto">
      {options.map(([value, label, count]) => (
        <button key={value} id={`tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`}
          onClick={() => onChange(value)}
          className="min-h-11 flex-1 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition aria-selected:bg-primary aria-selected:text-white sm:flex-none">
          {label} <span className="tabular-nums">({count})</span>
        </button>
      ))}
    </div>
  );
}

export function AppointmentStatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`inline-flex w-fit shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {status === 'PAST_SCHEDULED' && <span aria-hidden="true" className="mr-1">!</span>}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TabPanel({ tab, value, children }: { tab: AppointmentTab; value: AppointmentTab; children: ReactNode }) {
  if (tab !== value) return null;
  return <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`}>{children}</div>;
}
