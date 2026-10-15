'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { PageIntro } from '../../../components/app-shell';
import { AvailabilityForm } from '../../../components/availability-form';
import { EmptyState, Icon, Notice, StatusPill } from '../../../components/ui';
import { formatTimeRange } from '../../../lib/appointments';
import { createMyAvailability, deleteMyAvailability, getMyAvailability, type AvailabilityBlock, type CreateAvailabilityPayload } from '../../../lib/api';
import { isAccessError, portalError, requireSessionToken, WEEK_DAYS } from '../../../lib/psychologist';

export default function MyAvailabilityPage() {
  const [blocks, setBlocks] = useState<AvailabilityBlock[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getMyAvailability(requireSessionToken());
        if (active) setBlocks(result);
      } catch (caught) {
        if (active) {
          setBlocks(null);
          setError(portalError(caught, 'No fue posible cargar tu disponibilidad. Revisa tu conexión y reintenta.'));
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
    setConfirmId(null);
    setRevision((value) => value + 1);
  }

  async function save(payload: CreateAvailabilityPayload): Promise<boolean> {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setPending('create');
    setError(null);
    setSuccess('');
    try {
      await createMyAvailability(requireSessionToken(), payload);
      setSuccess('Horario agregado correctamente.');
      refresh();
      return true;
    } catch (caught) {
      const nextError = portalError(caught, 'No se pudo confirmar si el horario se guardó. Actualiza la lista antes de intentarlo de nuevo.');
      setError(nextError);
      if (isAccessError(nextError)) setBlocks(null);
      return false;
    } finally {
      mutationInFlight.current = false;
      setPending(null);
    }
  }

  async function remove(id: string) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPending(id);
    setError(null);
    setSuccess('');
    try {
      await deleteMyAvailability(requireSessionToken(), id);
      setSuccess('Horario eliminado correctamente.');
      refresh();
    } catch (caught) {
      const nextError = portalError(caught, 'No se pudo confirmar si el horario se eliminó. Actualiza la lista antes de intentarlo de nuevo.');
      setError(nextError);
      if (isAccessError(nextError)) setBlocks(null);
    } finally {
      mutationInFlight.current = false;
      setPending(null);
      setConfirmId(null);
    }
  }

  const disabled = loading || pending !== null || blocks === null || isAccessError(error);

  return (
    <>
      <PageIntro
        kicker="Portal del psicólogo"
        title="Mi disponibilidad"
        description="Bloques semanales en los que los pacientes pueden agendar. Hora de Colombia (Bogotá)."
        actions={<button type="button" onClick={refresh} disabled={loading || pending !== null || isAccessError(error)} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar lista</button>}
      />
      <div className="mb-5 space-y-3">
        {error && <ApiErrorNotice error={error} onRetry={pending === null ? refresh : undefined} />}
        {success && <Notice tone="success">{success}</Notice>}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Horarios actuales" aria-busy={loading} className="space-y-4">
          {loading ? <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando disponibilidad...</p>
            : blocks?.length === 0 ? <EmptyState icon="clock" title="Aún no tienes horarios" text="Agrega tu primer bloque de disponibilidad para recibir citas." />
              : blocks && WEEK_DAYS.map((day) => {
                const dayBlocks = blocks.filter((block) => block.dayOfWeek === day.value).sort((a, b) => a.startTime.localeCompare(b.startTime));
                if (!dayBlocks.length) return null;
                return (
                  <section key={day.value} className="surface p-5 sm:p-6">
                    <h2 className="flex items-center gap-3 font-serif text-xl">
                      <span aria-hidden="true" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-mint font-sans text-sm font-bold uppercase text-forest">{day.label.slice(0, 2)}</span>
                      {day.label}
                      <StatusPill tone="green">{dayBlocks.length} {dayBlocks.length === 1 ? 'bloque' : 'bloques'}</StatusPill>
                    </h2>
                    <ul className="mt-4 space-y-3">
                      {dayBlocks.map((block) => (
                        <li key={block.id} className="rounded-2xl border border-[rgba(54,91,69,0.12)] bg-background/60 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="inline-flex items-center gap-2 text-base font-semibold tabular-nums"><Icon name="clock" size={18} className="text-primary" />{formatTimeRange(block.startTime, block.endTime)}</p>
                            <button type="button" disabled={disabled} onClick={() => setConfirmId(block.id)} aria-label={`Eliminar horario del ${day.label.toLowerCase()} de ${block.startTime} a ${block.endTime}`} className="btn btn-danger"><Icon name="trash" size={17} />Eliminar</button>
                          </div>
                          {confirmId === block.id && (
                            <div className="mt-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
                              <p className="text-sm font-semibold">¿Eliminar el horario del {day.label.toLowerCase()} de {formatTimeRange(block.startTime, block.endTime)}?</p>
                              <p className="mt-1 text-xs">Los pacientes ya no podrán agendar en este bloque. Las citas ya agendadas no se modifican.</p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <button type="button" disabled={disabled} onClick={() => void remove(block.id)} className="btn btn-danger-solid">{pending === block.id ? 'Eliminando...' : 'Sí, eliminar'}</button>
                                <button type="button" disabled={pending !== null} onClick={() => setConfirmId(null)} className="btn btn-quiet">Conservar horario</button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
        </section>
        <AvailabilityForm disabled={disabled} saving={pending === 'create'} onSave={save} />
      </div>
    </>
  );
}
