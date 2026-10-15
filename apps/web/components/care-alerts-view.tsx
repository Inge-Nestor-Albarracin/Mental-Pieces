'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CareAlert, CareAlertPage } from '../lib/api';
import { LEVEL_LABEL, reasonLabel } from '../lib/care-alerts';
import { isAccessError, portalError, requireSessionToken } from '../lib/psychologist';
import { ApiErrorNotice } from './api-error-notice';

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
  }).format(new Date(`${date}T12:00:00-05:00`));
}

// Operational follow-up list. Shows appointment metadata only; no clinical content.
export function CareAlertsView({ load, showPsychologist, patientHref }: {
  load: (token: string, page: number) => Promise<CareAlertPage>;
  showPsychologist: boolean;
  patientHref?: (alert: CareAlert) => string;
}) {
  const [data, setData] = useState<CareAlertPage | null>(null);
  const [items, setItems] = useState<CareAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const result = await load(requireSessionToken(), 1);
        if (!active) return;
        setData(result);
        setItems(result.items);
      } catch (caught) {
        if (!active) return;
        setData(null);
        setItems([]);
        setError(portalError(caught, 'No fue posible cargar las alertas. Revisa tu conexión y reintenta.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void run();
    return () => { active = false; };
  }, [load, revision]);

  function refresh() {
    setLoading(true);
    setError(null);
    setRevision((value) => value + 1);
  }

  async function loadMore() {
    if (!data) return;
    setLoadingMore(true);
    try {
      const next = await load(requireSessionToken(), data.page + 1);
      setData(next);
      setItems((current) => [...current, ...next.items]);
    } catch (caught) {
      const failure = portalError(caught, 'No fue posible cargar más alertas.');
      if (isAccessError(failure)) { setData(null); setItems([]); }
      setError(failure);
    } finally {
      setLoadingMore(false);
    }
  }

  const high = items.filter((item) => item.level === 'HIGH').length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-serif text-3xl">Alertas de seguimiento</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Relaciones clínicas activas con señales de inactividad o posible abandono, calculadas con reglas fijas a partir de las citas. Son avisos operativos, no valoraciones clínicas.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={loading || isAccessError(error)} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Actualizar</button>
      </div>

      {error && <ApiErrorNotice error={error} onRetry={refresh} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />}

      {loading ? (
        <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Calculando alertas...</p>
      ) : data && (
        <>
          <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
            {data.total === 0 ? 'Sin alertas.' : `${data.total} ${data.total === 1 ? 'alerta' : 'alertas'}${high > 0 ? ` · ${high} de prioridad alta en esta página` : ''}.`}
          </p>
          {data.truncated && (
            <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              Hay más relaciones activas de las que se evaluaron en esta consulta; la lista puede estar incompleta.
            </p>
          )}
          {items.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-border bg-card p-6">
              <h2 className="font-serif text-xl">Todo al día</h2>
              <p className="mt-2 text-sm text-muted-foreground">Ninguna relación activa cumple los criterios de alerta en este momento.</p>
            </section>
          ) : (
            <ul className="space-y-4">
              {items.map((alert) => {
                const name = alert.patient.fullName?.trim() || 'Paciente sin nombre registrado';
                return (
                  <li key={alert.relationshipId} className={`rounded-2xl border bg-card p-5 sm:p-6 ${alert.level === 'HIGH' ? 'border-red-300' : 'border-amber-300'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="break-words font-serif text-xl">{name}</h2>
                        {showPsychologist && alert.psychologist && (
                          <p className="mt-1 break-words text-sm text-muted-foreground">Psicólogo: {alert.psychologist.fullName?.trim() || 'Sin nombre registrado'}</p>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${alert.level === 'HIGH' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                        {alert.level === 'HIGH' ? '▲ ' : '● '}{LEVEL_LABEL[alert.level]}
                      </span>
                    </div>
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                      {alert.reasons.map((reason) => <li key={reason}>{reasonLabel(reason, alert, data.rules)}</li>)}
                    </ul>
                    <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <div><dt className="inline">Última sesión: </dt><dd className="inline">{alert.lastSessionDate ? formatDate(alert.lastSessionDate) : 'Ninguna'}</dd></div>
                      <div><dt className="inline">Próxima cita: </dt><dd className="inline">{alert.nextAppointmentDate ? formatDate(alert.nextAppointmentDate) : 'Sin programar'}</dd></div>
                    </dl>
                    {patientHref && (
                      <Link href={patientHref(alert)} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[#47664C] hover:underline">
                        Ver seguimiento <span aria-hidden="true" className="ml-2">→</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {data.hasMore && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-6 min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">
              {loadingMore ? 'Cargando...' : 'Cargar más alertas'}
            </button>
          )}
        </>
      )}
    </>
  );
}
