'use client';

import { useEffect, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { getPsychologistAppointments, type PsychologistAppointment } from '../../../lib/api';
import { isAccessError, portalError, requireSessionToken } from '../../../lib/psychologist';

const STATUS: Record<PsychologistAppointment['status'], { label: string; style: string }> = {
  SCHEDULED: { label: 'Programada', style: 'bg-[#E5EEE6] text-[#38543D]' },
  CANCELLED: { label: 'Cancelada', style: 'bg-red-50 text-red-800' },
  COMPLETED: { label: 'Completada', style: 'bg-secondary text-foreground' },
  NO_SHOW: { label: 'No asistió', style: 'bg-amber-50 text-amber-900' },
};

function formatDate(date: string) {
  // appointmentDate is a calendar date, not an instant to convert to local time.
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
  }).format(new Date(`${date}T12:00:00-05:00`));
}

export default function PsychologistAppointmentsPage() {
  const [appointments, setAppointments] = useState<PsychologistAppointment[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getPsychologistAppointments(requireSessionToken());
        if (active) setAppointments(result);
      } catch (caught) {
        if (active) {
          setAppointments(null);
          setError(portalError(caught, 'No fue posible cargar tu agenda. Revisa tu conexión y reintenta.'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [revision]);

  function refresh() {
    setLoading(true);
    setError(null);
    setAppointments(null);
    setRevision((value) => value + 1);
  }

  const groups = new Map<string, PsychologistAppointment[]>();
  for (const appointment of [...(appointments ?? [])].sort((a, b) =>
    a.appointmentDate.localeCompare(b.appointmentDate) || a.startTime.localeCompare(b.startTime))) {
    const group = groups.get(appointment.appointmentDate) ?? [];
    group.push(appointment);
    groups.set(appointment.appointmentDate, group);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Portal del psicólogo</p>
          <h1 className="mt-1 font-serif text-3xl">Mi agenda</h1>
          <p className="mt-2 text-sm text-muted-foreground">Tus citas por fecha · Hora de Bogotá (America/Bogota)</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading || isAccessError(error)} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Actualizar agenda</button>
      </div>
      {error && <ApiErrorNotice error={error} onRetry={refresh} />}
      {loading ? <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando agenda...</p>
        : appointments?.length === 0 ? <section className="rounded-2xl border border-dashed border-border bg-card p-6"><h2 className="font-serif text-xl">Aún no tienes citas</h2><p className="mt-2 text-sm text-muted-foreground">Cuando se agende una cita contigo, aparecerá aquí.</p></section>
          : <div className="space-y-6">
            {Array.from(groups, ([date, items]) => (
              <section key={date} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <h2 className="font-serif text-xl capitalize"><time dateTime={date}>{formatDate(date)}</time></h2>
                <ul className="mt-4 divide-y divide-border">
                  {items.map((appointment) => (
                    <li key={appointment.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-lg font-medium tabular-nums">{appointment.startTime} – {appointment.endTime}</p>
                        <p className="mt-1 break-words text-sm text-muted-foreground">{appointment.patient.fullName?.trim() || 'Paciente sin nombre registrado'}</p>
                      </div>
                      <span className={`w-fit shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS[appointment.status].style}`}>{STATUS[appointment.status].label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>}
    </>
  );
}
