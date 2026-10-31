'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { PageIntro } from '../../../components/app-shell';
import { DateBlock, EmptyState, Icon, Notice, StatusPill } from '../../../components/ui';
import { getDeskAgenda, type DeskAgenda } from '../../../lib/api';
import { formatCalendarDate, formatTimeRange } from '../../../lib/appointments';
import { isAccessError, portalError, withSession } from '../../../lib/psychologist';
import { AGENDA_RANGES, groupByDate } from '../../../lib/staff-desk';

export default function StaffDashboardPage() {
  return (
    <Suspense fallback={<p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando agenda...</p>}>
      <StaffAgenda />
    </Suspense>
  );
}

function StaffAgenda() {
  const booked = useSearchParams().get('agendada') === '1';
  const [agenda, setAgenda] = useState<DeskAgenda | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number>(14);
  const [psychologistId, setPsychologistId] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    withSession((token) => getDeskAgenda(token, days))
      .then((result) => { if (active) { setAgenda(result); setError(null); } })
      .catch((caught: unknown) => {
        if (active) setError(portalError(caught, 'No fue posible cargar la agenda. Revisa tu conexión y reintenta.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, revision]);

  function reload(nextDays = days) {
    setLoading(true);
    setDays(nextDays);
    setRevision((value) => value + 1);
  }

  const groups = agenda?.psychologists.filter((group) => !psychologistId || group.psychologist.id === psychologistId) ?? [];
  const total = groups.reduce((sum, group) => sum + group.appointments.length, 0);

  return (
    <>
      <PageIntro
        kicker="Recepción"
        title="Agenda de psicólogos"
        description="Próximas citas de cada psicólogo. Horas en hora de Colombia (Bogotá)."
        actions={(
          <>
            <button type="button" onClick={() => reload()} disabled={loading || isAccessError(error)} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar</button>
            <Link href="/staff/appointments/new" className="btn btn-primary"><Icon name="calendarPlus" size={18} />Agendar cita</Link>
          </>
        )}
      />
      {booked && <Notice tone="success">Cita agendada. El paciente y el psicólogo reciben la confirmación.</Notice>}
      {error && <ApiErrorNotice error={error} onRetry={() => reload()} />}

      {agenda && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5 sm:w-72">
            <label htmlFor="agenda-psychologist" className="field-label">Psicólogo</label>
            <select id="agenda-psychologist" value={psychologistId} onChange={(event) => setPsychologistId(event.target.value)} className="field">
              <option value="">Todos los psicólogos</option>
              {agenda.psychologists.map((group) => (
                <option key={group.psychologist.id} value={group.psychologist.id}>{group.psychologist.fullName ?? 'Sin nombre'}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Periodo">
            {AGENDA_RANGES.map((range) => (
              <button key={range.days} type="button" aria-pressed={days === range.days} onClick={() => reload(range.days)}
                className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium transition hover:border-forest aria-pressed:border-forest aria-pressed:bg-mint aria-pressed:ring-2 aria-pressed:ring-forest/25">
                Próximos {range.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground sm:ml-auto" role="status">{total} {total === 1 ? 'cita' : 'citas'}</p>
        </div>
      )}

      {loading && !agenda ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando agenda...</p>
      ) : agenda && (
        groups.length === 0 ? (
          <EmptyState icon="users" title="No hay psicólogos activos" text="Cuando el administrador cree psicólogos, aparecerán aquí." />
        ) : (
          <div className="space-y-6">
            {groups.map(({ psychologist, appointments }) => (
              <section key={psychologist.id} className="surface p-5 sm:p-6" aria-labelledby={`psy-${psychologist.id}`}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id={`psy-${psychologist.id}`} className="break-words font-serif text-xl">{psychologist.fullName ?? 'Psicólogo sin nombre'}</h2>
                    {psychologist.position && <p className="text-sm text-muted-foreground">{psychologist.position}</p>}
                  </div>
                  <StatusPill tone={appointments.length ? 'green' : 'gray'}>
                    {appointments.length} {appointments.length === 1 ? 'cita próxima' : 'citas próximas'}
                  </StatusPill>
                </div>
                {appointments.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">Sin citas en este periodo.</p>
                ) : (
                  <div className="space-y-4">
                    {groupByDate(appointments).map(([date, items]) => (
                      <div key={date} className="flex gap-4">
                        <DateBlock date={date} />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold first-letter:uppercase">{formatCalendarDate(date)}</h3>
                          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-background">
                            {items.map((item) => (
                              <li key={item.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                                <span className="shrink-0 text-sm font-medium tabular-nums">{formatTimeRange(item.startTime, item.endTime)}</span>
                                <span className="min-w-0 flex-1 break-words text-sm">
                                  {item.patient.fullName?.trim() || 'Paciente sin nombre registrado'}
                                  <span className="ml-2 text-xs text-muted-foreground">{item.patient.mrn}</span>
                                </span>
                                {item.bookedByStaff && <StatusPill tone="violet">Agendada por recepción</StatusPill>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )
      )}
    </>
  );
}
