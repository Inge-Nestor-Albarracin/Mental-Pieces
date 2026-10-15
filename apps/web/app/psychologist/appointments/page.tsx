'use client';

import { useEffect, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { AppointmentStatusBadge, AppointmentTabs, TabPanel, type AppointmentTab } from '../../../components/appointment-tabs';
import {
  ApiError,
  completePsychologistAppointment,
  getPsychologistAppointments,
  markPsychologistAppointmentNoShow,
  type PsychologistAppointment,
} from '../../../lib/api';
import {
  appointmentErrorMessage,
  businessNow,
  canPsychologistClose,
  displayStatus,
  formatCalendarDate,
  formatTimeRange,
  splitAppointments,
  type BusinessNow,
} from '../../../lib/appointments';
import { isAccessError, portalError, requireSessionToken } from '../../../lib/psychologist';

export default function PsychologistAppointmentsPage() {
  const [appointments, setAppointments] = useState<PsychologistAppointment[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<AppointmentTab>('upcoming');
  const [now, setNow] = useState<BusinessNow>(() => businessNow());
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    getPsychologistAppointments(requireSessionToken())
      .then((result) => {
        if (!active) return;
        setAppointments(result);
        setNow(businessNow());
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setAppointments(null);
        setError(portalError(caught, 'No fue posible cargar tu agenda. Revisa tu conexión y reintenta.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    const timer = setInterval(() => setNow(businessNow()), 60_000);
    return () => clearInterval(timer);
  }, []);

  function refresh(message = '') {
    setLoading(true);
    setError(null);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  const { upcoming, history } = splitAppointments(appointments ?? [], now);
  const pending = history.filter((item) => canPsychologistClose(item, now)).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Portal del psicólogo</p>
          <h1 className="mt-1 font-serif text-3xl">Mi agenda</h1>
          <p className="mt-2 text-sm text-muted-foreground">Horas en hora de Colombia (Bogotá).</p>
        </div>
        <button type="button" onClick={() => refresh()} disabled={loading || isAccessError(error)} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Actualizar agenda</button>
      </div>
      {error && <ApiErrorNotice error={error} onRetry={() => refresh()} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />}
      {notice && <p role="status" className="mb-4 rounded-xl border border-[#C9DACB] bg-[#EEF4EF] p-4 text-sm text-[#38543D]">{notice}</p>}

      {loading && !appointments ? (
        <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando agenda...</p>
      ) : appointments && (
        <>
          {pending > 0 && (
            <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              Tienes {pending} {pending === 1 ? 'sesión pasada pendiente' : 'sesiones pasadas pendientes'} de cierre. Indica si se realizó o si hubo inasistencia en el Historial.
              {tab !== 'history' && <button type="button" onClick={() => setTab('history')} className="ml-1 min-h-11 font-semibold underline">Ver historial</button>}
            </p>
          )}
          <AppointmentTabs tab={tab} onChange={setTab} upcoming={upcoming.length} history={history.length} />
          <TabPanel tab={tab} value="upcoming">
            {upcoming.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-border bg-card p-6">
                <h2 className="font-serif text-xl">No tienes próximas citas</h2>
                <p className="mt-2 text-sm text-muted-foreground">Cuando un paciente agende contigo, la cita aparecerá aquí.</p>
              </section>
            ) : (
              <ul className="space-y-4">{upcoming.map((item) => <AgendaCard key={item.id} item={item} now={now} onChanged={refresh} />)}</ul>
            )}
          </TabPanel>
          <TabPanel tab={tab} value="history">
            {history.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-border bg-card p-6">
                <p className="text-sm text-muted-foreground">Aún no hay citas pasadas ni canceladas.</p>
              </section>
            ) : (
              <ul className="space-y-4">{history.map((item) => <AgendaCard key={item.id} item={item} now={now} onChanged={refresh} />)}</ul>
            )}
          </TabPanel>
        </>
      )}
    </>
  );
}

function AgendaCard({ item, now, onChanged }: {
  item: PsychologistAppointment;
  now: BusinessNow;
  onChanged: (message?: string) => void;
}) {
  const status = displayStatus(item, now);
  const closable = canPsychologistClose(item, now);
  const [busy, setBusy] = useState<'complete' | 'no-show' | null>(null);
  const [actionError, setActionError] = useState('');

  async function close(action: 'complete' | 'no-show') {
    setBusy(action);
    setActionError('');
    try {
      const token = requireSessionToken();
      if (action === 'complete') await completePsychologistAppointment(token, item.id);
      else await markPsychologistAppointmentNoShow(token, item.id);
      onChanged(action === 'complete' ? 'Cita marcada como realizada.' : 'Inasistencia registrada.');
    } catch (caught) {
      setActionError(appointmentErrorMessage(caught, 'close'));
      if (caught instanceof ApiError && (isAccessError(caught) || caught.status === 404)) onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={`rounded-2xl border bg-card p-5 sm:p-6 ${status === 'PAST_SCHEDULED' ? 'border-amber-300' : 'border-border'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm capitalize"><time dateTime={item.appointmentDate}>{formatCalendarDate(item.appointmentDate)}</time></p>
          <p className="mt-1 text-lg font-medium tabular-nums">{formatTimeRange(item.startTime, item.endTime)}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{item.patient.fullName?.trim() || 'Paciente sin nombre registrado'}</p>
        </div>
        <AppointmentStatusBadge status={status} />
      </div>
      {closable && (
        <div className="mt-4">
          <p className="text-sm text-amber-950">Esta sesión ya terminó. ¿Cómo debe quedar registrada?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void close('complete')} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy === 'complete' ? 'Guardando...' : 'Marcar realizada'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void close('no-show')} className="min-h-11 rounded-xl border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-60">
              {busy === 'no-show' ? 'Guardando...' : 'Marcar inasistencia'}
            </button>
          </div>
        </div>
      )}
      {actionError && <p role="alert" className="mt-3 text-sm text-red-800">{actionError}</p>}
    </li>
  );
}
