'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CareAlert, CareAlertPage } from '../lib/api';
import { formatCalendarDate } from '../lib/appointments';
import { LEVEL_LABEL, reasonLabel } from '../lib/care-alerts';
import { isAccessError, portalError, requireSessionToken } from '../lib/psychologist';
import { ApiErrorNotice } from './api-error-notice';
import { PageIntro } from './app-shell';
import { EmptyState, Icon, StatusPill } from './ui';

// Operational follow-up list. Shows appointment metadata only; no clinical content.
export function CareAlertsView({ load, showPsychologist, patientHref, kicker }: {
  kicker: string;
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
      <PageIntro
        kicker={kicker}
        title="Alertas de seguimiento"
        description="Relaciones clínicas activas con señales de inactividad o posible abandono, calculadas con reglas fijas a partir de las citas. Son avisos operativos, no valoraciones clínicas."
        actions={<button type="button" onClick={refresh} disabled={loading || isAccessError(error)} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar</button>}
      />

      {error && <ApiErrorNotice error={error} onRetry={refresh} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />}

      {loading ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Calculando alertas...</p>
      ) : data && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3" aria-live="polite">
            <Summary label="Alertas" value={data.total} tone="neutral" />
            <Summary label="Prioridad alta (esta página)" value={high} tone="high" />
            <Summary label="Seguimiento (esta página)" value={items.length - high} tone="medium" />
          </div>
          {data.truncated && (
            <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />Hay más relaciones activas de las que se evaluaron en esta consulta; la lista puede estar incompleta.
            </p>
          )}
          {items.length === 0 ? (
            <EmptyState icon="check" title="Todo al día" text="Ninguna relación activa cumple los criterios de alerta en este momento." />
          ) : (
            <ul className="space-y-4">
              {items.map((alert) => {
                const name = alert.patient.fullName?.trim() || 'Paciente sin nombre registrado';
                const isHigh = alert.level === 'HIGH';
                return (
                  <li key={alert.relationshipId} className={`relative overflow-hidden rounded-[22px] border bg-paper p-5 pl-7 shadow-[var(--shadow-soft)] sm:p-6 sm:pl-8 ${isHigh ? 'border-red-300' : 'border-amber-300'}`}>
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-2 ${isHigh ? 'bg-red-600' : 'bg-amber-400'}`} />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] ${isHigh ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}><Icon name={isHigh ? 'alert' : 'bell'} size={22} /></span>
                        <div className="min-w-0">
                          <h2 className="break-words font-serif text-xl">{name}</h2>
                          {showPsychologist && alert.psychologist && (
                            <p className="mt-0.5 inline-flex items-center gap-1.5 break-words text-sm text-ink-soft"><Icon name="profile" size={15} />Psicólogo: {alert.psychologist.fullName?.trim() || 'Sin nombre registrado'}</p>
                          )}
                        </div>
                      </div>
                      <StatusPill tone={isHigh ? 'red' : 'amber'}>{LEVEL_LABEL[alert.level]}</StatusPill>
                    </div>
                    <ul className="mt-4 space-y-2 text-sm">
                      {alert.reasons.map((reason) => (
                        <li key={reason} className="flex items-start gap-2"><Icon name="arrow" size={16} className="mt-0.5 shrink-0 text-ink-soft" />{reasonLabel(reason, alert, data.rules)}</li>
                      ))}
                    </ul>
                    <dl className="mt-4 grid gap-2 rounded-2xl bg-background/70 p-3 text-xs text-ink-soft sm:grid-cols-2">
                      <div className="flex items-center gap-1.5"><Icon name="check" size={15} /><dt>Última sesión:</dt><dd className="font-semibold text-foreground first-letter:uppercase">{alert.lastSessionDate ? formatCalendarDate(alert.lastSessionDate) : 'Ninguna'}</dd></div>
                      <div className="flex items-center gap-1.5"><Icon name="calendar" size={15} /><dt>Próxima cita:</dt><dd className="font-semibold text-foreground first-letter:uppercase">{alert.nextAppointmentDate ? formatCalendarDate(alert.nextAppointmentDate) : 'Sin programar'}</dd></div>
                    </dl>
                    {patientHref && (
                      <Link href={patientHref(alert)} className="btn btn-secondary mt-4 w-full sm:w-auto">
                        Ver seguimiento <Icon name="arrow" size={17} />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {data.hasMore && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn btn-quiet mt-6">
              {loadingMore ? 'Cargando...' : 'Cargar más alertas'}
            </button>
          )}
        </>
      )}
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'high' | 'medium' }) {
  const style = tone === 'high' ? 'border-red-200 bg-red-50/70 text-red-800' : tone === 'medium' ? 'border-amber-200 bg-amber-50/70 text-amber-900' : 'border-[rgba(54,91,69,0.13)] bg-paper text-forest';
  return (
    <div className={`rounded-[18px] border p-4 ${style}`}>
      <p className="font-serif text-3xl leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{label}</p>
    </div>
  );
}
