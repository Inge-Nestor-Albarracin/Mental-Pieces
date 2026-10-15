'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { ApiErrorNotice } from '../../components/api-error-notice';
import { AppHeader } from '../../components/app-header';
import { AppointmentStatusBadge, AppointmentTabs, TabPanel, type AppointmentTab } from '../../components/appointment-tabs';
import { RoleGate } from '../../components/role-gate';
import {
  ApiError,
  cancelAppointment,
  getAvailableSlots,
  getMyAppointments,
  rescheduleAppointment,
  type AppointmentSummary,
} from '../../lib/api';
import {
  NO_SLOTS_MESSAGE,
  appointmentErrorMessage,
  businessNow,
  canPatientModify,
  displayStatus,
  formatCalendarDate,
  formatClockTime,
  formatTimeRange,
  splitAppointments,
  type BusinessNow,
} from '../../lib/appointments';
import { isAccessError, portalError, requireSessionToken } from '../../lib/psychologist';

export default function AppointmentsPage() {
  return (
    <RoleGate role="PATIENT">
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
          <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Cargando citas...</p>}>
            <MyAppointments />
          </Suspense>
        </main>
      </div>
    </RoleGate>
  );
}

function MyAppointments() {
  const justBooked = useSearchParams().get('agendada') === '1';
  const [appointments, setAppointments] = useState<AppointmentSummary[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<AppointmentTab>('upcoming');
  const [now, setNow] = useState<BusinessNow>(() => businessNow());
  const [notice, setNotice] = useState(justBooked ? 'Cita agendada. Aparece en tus próximas citas.' : '');

  useEffect(() => {
    let active = true;
    getMyAppointments(requireSessionToken())
      .then((result) => {
        if (!active) return;
        setAppointments(result);
        setNow(businessNow());
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setAppointments(null);
        setError(portalError(caught, 'No fue posible cargar tus citas. Revisa tu conexión y reintenta.'));
      });
    return () => { active = false; };
  }, [revision]);

  // Keep the Upcoming/History split current while the page stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(businessNow()), 60_000);
    return () => clearInterval(timer);
  }, []);

  function reload(message = '') {
    setError(null);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  const { upcoming, history } = splitAppointments(appointments ?? [], now);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Mental Pieces</p>
          <h1 className="mt-1 font-serif text-3xl">Mis citas</h1>
          <p className="mt-2 text-sm text-muted-foreground">Horas en hora de Colombia (Bogotá).</p>
        </div>
        <Link href="/appointments/new" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#587A5E]">Agendar cita</Link>
      </div>

      {error && <ApiErrorNotice error={error} onRetry={() => reload()} messages={{ 404: 'No se encontró tu perfil de paciente.' }} />}
      {notice && <p role="status" className="mb-4 rounded-xl border border-[#C9DACB] bg-[#EEF4EF] p-4 text-sm text-[#38543D]">{notice}</p>}

      {!appointments && !error ? (
        <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando citas...</p>
      ) : appointments && (
        <>
          <AppointmentTabs tab={tab} onChange={setTab} upcoming={upcoming.length} history={history.length} />
          <TabPanel tab={tab} value="upcoming">
            {upcoming.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-border bg-card p-6">
                <h2 className="font-serif text-xl">No tienes próximas citas</h2>
                <p className="mt-2 text-sm text-muted-foreground">Cuando agendes una cita aparecerá aquí.</p>
              </section>
            ) : (
              <ul className="space-y-4">
                {upcoming.map((item) => <PatientAppointmentCard key={item.id} item={item} now={now} onChanged={reload} />)}
              </ul>
            )}
          </TabPanel>
          <TabPanel tab={tab} value="history">
            {history.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-border bg-card p-6">
                <p className="text-sm text-muted-foreground">Aún no tienes citas pasadas ni canceladas.</p>
              </section>
            ) : (
              <ul className="space-y-4">
                {history.map((item) => <PatientAppointmentCard key={item.id} item={item} now={now} onChanged={reload} />)}
              </ul>
            )}
          </TabPanel>
        </>
      )}
    </>
  );
}

function PatientAppointmentCard({ item, now, onChanged }: {
  item: AppointmentSummary;
  now: BusinessNow;
  onChanged: (message?: string) => void;
}) {
  const status = displayStatus(item, now);
  const modifiable = canPatientModify(item, now);
  const [mode, setMode] = useState<'idle' | 'cancel' | 'reschedule'>('idle');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState('');

  useEffect(() => {
    if (mode !== 'reschedule' || !date) return;
    let active = true;
    getAvailableSlots(requireSessionToken(), item.psychologist.id, date)
      .then((result) => { if (active) setSlots(result); })
      .catch((caught: unknown) => { if (active) { setSlots(null); setActionError(appointmentErrorMessage(caught, 'slots')); } })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [mode, date, item.psychologist.id]);

  function chooseDate(value: string) {
    setDate(value);
    setSlot('');
    setSlots(null);
    setActionError('');
    setSlotsLoading(Boolean(value));
  }

  async function run(action: 'cancel' | 'reschedule') {
    setBusy(true);
    setActionError('');
    try {
      const token = requireSessionToken();
      if (action === 'cancel') await cancelAppointment(token, item.id);
      else await rescheduleAppointment(token, item.id, { appointmentDate: date, startTime: slot });
      onChanged(action === 'cancel' ? 'Cita cancelada.' : 'Cita reagendada.');
    } catch (caught) {
      setActionError(appointmentErrorMessage(caught, action));
      if (caught instanceof ApiError && (isAccessError(caught) || caught.status === 404)) onChanged();
      if (action === 'reschedule' && caught instanceof ApiError && caught.status === 409) chooseDate(date);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-2xl border bg-card p-5 sm:p-6 ${status === 'PAST_SCHEDULED' ? 'border-amber-300' : 'border-border'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-medium">{item.psychologist.fullName?.trim() || 'Psicólogo'}</p>
          <p className="mt-1 text-sm capitalize"><time dateTime={item.appointmentDate}>{formatCalendarDate(item.appointmentDate)}</time></p>
          <p className="text-sm tabular-nums text-muted-foreground">{formatTimeRange(item.startTime, item.endTime)}</p>
          {status === 'PAST_SCHEDULED' && (
            <p className="mt-2 text-xs text-amber-900">La sesión ya pasó y tu psicólogo aún no la ha registrado como realizada o inasistencia.</p>
          )}
        </div>
        <AppointmentStatusBadge status={status} />
      </div>

      {modifiable && mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setMode('reschedule'); setActionError(''); }} className="min-h-11 rounded-xl border border-primary px-4 py-2 text-sm font-medium text-[#47664C] hover:bg-[#EEF4EF]">Reagendar</button>
          <button type="button" onClick={() => { setMode('cancel'); setActionError(''); }} className="min-h-11 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50">Cancelar cita</button>
        </div>
      )}

      {modifiable && mode === 'cancel' && (
        <div role="group" aria-label="Confirmar cancelación" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p>¿Cancelar esta cita? Esta acción no se puede deshacer.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run('cancel')} className="min-h-11 rounded-xl bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? 'Cancelando...' : 'Sí, cancelar cita'}</button>
            <button type="button" disabled={busy} onClick={() => setMode('idle')} className="min-h-11 rounded-xl border border-border bg-white px-4 py-2 font-medium">Volver</button>
          </div>
        </div>
      )}

      {modifiable && mode === 'reschedule' && (
        <div className="mt-4 space-y-3 rounded-xl border border-border bg-background p-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={`reschedule-${item.id}`} className="text-sm font-medium">Nueva fecha</label>
            {/* `min` is a UX hint only; the API rejects moves to the past. */}
            <input id={`reschedule-${item.id}`} type="date" min={now.date} value={date} onChange={(event) => chooseDate(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-auto" />
            {date && <p className="text-xs capitalize text-muted-foreground">{formatCalendarDate(date)}</p>}
          </div>
          {date && (
            <fieldset>
              <legend className="text-sm font-medium">Nueva hora</legend>
              {slotsLoading ? <p role="status" className="mt-2 text-sm text-muted-foreground">Consultando horarios...</p>
                : slots && slots.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{NO_SLOTS_MESSAGE}</p>
                  : slots && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {slots.map((value) => (
                        <button key={value} type="button" aria-pressed={slot === value} onClick={() => setSlot(value)}
                          className="min-h-11 rounded-xl border border-border bg-white px-3 py-2 text-sm font-medium aria-pressed:border-primary aria-pressed:bg-[#EEF4EF] aria-pressed:ring-2 aria-pressed:ring-primary/30">
                          {formatClockTime(value)}
                        </button>
                      ))}
                    </div>
                  )}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!slot || busy} onClick={() => void run('reschedule')} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Guardando...' : 'Guardar nuevo horario'}</button>
            <button type="button" disabled={busy} onClick={() => { setMode('idle'); chooseDate(''); }} className="min-h-11 rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium">Volver</button>
          </div>
        </div>
      )}

      {actionError && <p role="alert" className="mt-3 text-sm text-red-800">{actionError}</p>}
    </li>
  );
}
