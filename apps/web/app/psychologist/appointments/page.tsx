'use client';

import { useEffect, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { PageIntro } from '../../../components/app-shell';
import { AppointmentCard, AppointmentTabs, TabPanel, type AppointmentTab } from '../../../components/appointment-tabs';
import { EmptyState, Icon, Notice } from '../../../components/ui';
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
  splitAppointments,
  type BusinessNow,
} from '../../../lib/appointments';
import { isAccessError, portalError, withSession } from '../../../lib/psychologist';

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
    withSession((token) => getPsychologistAppointments(token))
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
      <PageIntro
        kicker="Portal del psicólogo"
        title="Mi agenda"
        description="Próximas sesiones e historial. Horas en hora de Colombia (Bogotá)."
        actions={<button type="button" onClick={() => refresh()} disabled={loading || isAccessError(error)} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar agenda</button>}
      />
      {error && <ApiErrorNotice error={error} onRetry={() => refresh()} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />}
      {notice && <Notice tone="success">{notice}</Notice>}

      {loading && !appointments ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando agenda...</p>
      ) : appointments && (
        <>
          {pending > 0 && (
            <div role="alert" className="mb-6 flex flex-col gap-3 rounded-[22px] border-2 border-amber-300 bg-amber-50 p-5 sm:flex-row sm:items-center">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-amber-100 text-amber-900"><Icon name="alert" size={22} /></span>
              <p className="flex-1 text-sm text-amber-950">
                <strong className="block text-base">{pending} {pending === 1 ? 'sesión pendiente' : 'sesiones pendientes'} de cierre</strong>
                Indica si cada sesión pasada se realizó o si hubo inasistencia.
              </p>
              {tab !== 'history' && <button type="button" onClick={() => setTab('history')} className="btn btn-primary">Ver pendientes</button>}
            </div>
          )}
          <AppointmentTabs tab={tab} onChange={setTab} upcoming={upcoming.length} history={history.length} />
          <TabPanel tab={tab} value="upcoming">
            {upcoming.length === 0 ? (
              <EmptyState title="No tienes próximas citas" text="Cuando un paciente agende contigo, la cita aparecerá aquí." />
            ) : (
              <ul className="space-y-4">{upcoming.map((item) => <AgendaCard key={item.id} item={item} now={now} onChanged={refresh} />)}</ul>
            )}
          </TabPanel>
          <TabPanel tab={tab} value="history">
            {history.length === 0 ? (
              <EmptyState icon="clock" title="Sin historial" text="Aún no hay citas pasadas ni canceladas." />
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
      await withSession((token) => action === 'complete'
        ? completePsychologistAppointment(token, item.id)
        : markPsychologistAppointmentNoShow(token, item.id));
      onChanged(action === 'complete' ? 'Cita marcada como realizada.' : 'Inasistencia registrada.');
    } catch (caught) {
      setActionError(appointmentErrorMessage(caught, 'close'));
      if (caught instanceof ApiError && (isAccessError(caught) || caught.status === 404)) onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppointmentCard appointmentDate={item.appointmentDate} startTime={item.startTime} endTime={item.endTime}
      status={status} person={item.patient.fullName?.trim() || 'Paciente sin nombre registrado'} personIcon="users">
      {closable || actionError ? (
        <>
          {closable && (
            <div>
              <p className="mb-3 text-sm font-semibold text-amber-950">Esta sesión ya terminó. ¿Cómo debe quedar registrada?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" disabled={busy !== null} onClick={() => void close('complete')} className="btn btn-primary min-h-14 w-full text-base">
                  <Icon name="check" size={20} />{busy === 'complete' ? 'Guardando...' : 'Marcar realizada'}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => void close('no-show')} className="btn min-h-14 w-full border-2 border-amber-400 bg-white text-base text-amber-950 hover:bg-amber-50 disabled:opacity-60">
                  <Icon name="x" size={20} />{busy === 'no-show' ? 'Guardando...' : 'Marcar inasistencia'}
                </button>
              </div>
            </div>
          )}
          {actionError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{actionError}</p>}
        </>
      ) : null}
    </AppointmentCard>
  );
}
