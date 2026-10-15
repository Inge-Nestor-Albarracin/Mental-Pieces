'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { ApiErrorNotice } from '../../components/api-error-notice';
import { PageIntro } from '../../components/app-shell';
import { AppointmentCard, AppointmentTabs, TabPanel, type AppointmentTab } from '../../components/appointment-tabs';
import { EmptyState, Icon, Notice } from '../../components/ui';
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
  sessionEndTime,
  splitAppointments,
  type BusinessNow,
} from '../../lib/appointments';
import { isAccessError, portalError, withSession } from '../../lib/psychologist';

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Cargando citas...</p>}>
      <MyAppointments />
    </Suspense>
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
    withSession((token) => getMyAppointments(token))
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
      <PageIntro
        kicker="Tu agenda"
        title="Mis citas"
        description="Gestiona tus próximas sesiones y consulta tu historial. Horas en hora de Colombia (Bogotá)."
        actions={<Link href="/appointments/new" className="btn btn-primary"><Icon name="calendarPlus" size={18} />Agendar cita</Link>}
      />

      {error && <ApiErrorNotice error={error} onRetry={() => reload()} messages={{ 404: 'No se encontró tu perfil de paciente.' }} />}
      {notice && <Notice tone="success">{notice}</Notice>}

      {!appointments && !error ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando citas...</p>
      ) : appointments && (
        <>
          <AppointmentTabs tab={tab} onChange={setTab} upcoming={upcoming.length} history={history.length} />
          <TabPanel tab={tab} value="upcoming">
            {upcoming.length === 0 ? (
              <EmptyState title="No tienes próximas citas" text="Cuando agendes una cita aparecerá aquí."
                action={<Link href="/appointments/new" className="btn btn-primary w-full sm:w-auto">Agendar cita</Link>} />
            ) : (
              <ul className="space-y-4">
                {upcoming.map((item) => <PatientAppointmentCard key={item.id} item={item} now={now} onChanged={reload} />)}
              </ul>
            )}
          </TabPanel>
          <TabPanel tab={tab} value="history">
            {history.length === 0 ? (
              <EmptyState icon="clock" title="Sin historial" text="Aún no tienes citas pasadas ni canceladas." />
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
  const [slotsRevision, setSlotsRevision] = useState(0);
  const [slot, setSlot] = useState('');

  useEffect(() => {
    if (mode !== 'reschedule' || !date) return;
    let active = true;
    withSession((token) => getAvailableSlots(token, item.psychologist.id, date))
      .then((result) => { if (active) setSlots(result); })
      .catch((caught: unknown) => { if (active) { setSlots(null); setActionError(appointmentErrorMessage(caught, 'slots')); } })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [mode, date, item.psychologist.id, slotsRevision]);

  function chooseDate(value: string) {
    setDate(value);
    setSlot('');
    setSlots(null);
    setActionError('');
    setSlotsLoading(Boolean(value));
  }

  function close() {
    setMode('idle');
    setActionError('');
    chooseDate('');
  }

  async function run(action: 'cancel' | 'reschedule') {
    setBusy(true);
    setActionError('');
    try {
      await withSession((token) => action === 'cancel'
        ? cancelAppointment(token, item.id)
        : rescheduleAppointment(token, item.id, { appointmentDate: date, startTime: slot }));
      onChanged(action === 'cancel' ? 'Cita cancelada.' : 'Cita reagendada.');
    } catch (caught) {
      setActionError(appointmentErrorMessage(caught, action));
      if (caught instanceof ApiError && (isAccessError(caught) || caught.status === 404)) onChanged();
      if (action === 'reschedule' && caught instanceof ApiError && caught.status === 409) {
        chooseDate(date);
        setSlotsRevision((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  const note = status === 'PAST_SCHEDULED'
    ? <p className="flex items-start gap-2 text-amber-900"><Icon name="alert" size={17} className="mt-0.5 shrink-0" />La sesión ya pasó y tu psicólogo aún no la ha registrado como realizada o inasistencia.</p>
    : status === 'IN_PROGRESS'
      ? <p className="text-sky-900">Tu sesión está en curso.</p>
      : undefined;

  return (
    <AppointmentCard
      appointmentDate={item.appointmentDate} startTime={item.startTime} endTime={item.endTime}
      status={status} person={item.psychologist.fullName?.trim() || 'Psicólogo'} note={note}
    >
      {modifiable || actionError ? (<>
      {modifiable && mode === 'idle' && (
        <div>
          <p className="mb-3 text-sm font-semibold text-foreground">¿Necesitas cambiar esta cita?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => { setMode('reschedule'); setActionError(''); }} className="btn btn-primary min-h-14 w-full text-base">
              <Icon name="repeat" size={20} /> Reagendar cita
            </button>
            <button type="button" onClick={() => { setMode('cancel'); setActionError(''); }} className="btn btn-danger min-h-14 w-full text-base">
              <Icon name="x" size={20} /> Cancelar cita
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">Puedes hacerlo hasta antes de que comience la sesión.</p>
        </div>
      )}

      {modifiable && mode === 'cancel' && (
        <div role="group" aria-label="Confirmar cancelación" className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-900 sm:p-5">
          <p className="flex items-start gap-2 font-semibold"><Icon name="alert" size={19} className="mt-0.5 shrink-0" />¿Seguro que quieres cancelar esta cita?</p>
          <p className="mt-1 text-sm">Esta acción no se puede deshacer. Si solo necesitas otro horario, elige «Reagendar».</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={busy} onClick={() => void run('cancel')} className="btn btn-danger-solid min-h-12 w-full">
              <Icon name="x" size={18} />{busy ? 'Cancelando...' : 'Sí, cancelar cita'}
            </button>
            <button type="button" disabled={busy} onClick={close} className="btn btn-quiet min-h-12 w-full">No, conservarla</button>
          </div>
        </div>
      )}

      {modifiable && mode === 'reschedule' && (
        <div className="space-y-4 rounded-2xl border-2 border-[rgba(54,91,69,0.25)] bg-mint/50 p-4 sm:p-5">
          <p className="flex items-center gap-2 font-semibold text-forest-deep"><Icon name="repeat" size={19} />Elige el nuevo horario</p>
          <div className="flex flex-col gap-2">
            <label htmlFor={`reschedule-${item.id}`} className="field-label">Nueva fecha</label>
            {/* `min` is a UX hint only; the API rejects moves to the past. */}
            <input id={`reschedule-${item.id}`} type="date" min={now.date} value={date} onChange={(event) => chooseDate(event.target.value)} className="field sm:max-w-xs" />
            {date && <p className="text-xs text-ink-soft first-letter:uppercase">{formatCalendarDate(date)}</p>}
          </div>
          {date && (
            <fieldset>
              <legend className="field-label">Nueva hora</legend>
              {slotsLoading ? <p role="status" className="mt-2 text-sm text-ink-soft">Consultando horarios...</p>
                : slots && slots.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{NO_SLOTS_MESSAGE}</p>
                  : slots && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Nueva hora">
                      {slots.map((value) => (
                        <button key={value} type="button" role="radio" aria-checked={slot === value} onClick={() => setSlot(value)}
                          className="min-h-11 rounded-xl border border-border bg-paper px-3 py-2 text-sm font-semibold tabular-nums transition hover:border-forest aria-checked:border-forest aria-checked:bg-forest aria-checked:text-white">
                          {formatClockTime(value)}
                        </button>
                      ))}
                    </div>
                  )}
            </fieldset>
          )}
          {slot && <p className="text-sm text-forest-deep">Nuevo horario: <strong className="first-letter:uppercase">{formatCalendarDate(date)}, {formatTimeRange(slot, sessionEndTime(slot))}</strong></p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!slot || busy} onClick={() => void run('reschedule')} className="btn btn-primary min-h-12 w-full">
              <Icon name="check" size={18} />{busy ? 'Guardando...' : 'Confirmar nuevo horario'}
            </button>
            <button type="button" disabled={busy} onClick={close} className="btn btn-quiet min-h-12 w-full">Volver</button>
          </div>
        </div>
      )}

      {actionError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{actionError}</p>}
      </>) : null}
    </AppointmentCard>
  );
}
