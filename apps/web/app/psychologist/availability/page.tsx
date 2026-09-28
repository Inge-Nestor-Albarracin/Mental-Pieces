'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { AvailabilityForm } from '../../../components/availability-form';
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Portal del psicólogo</p>
          <h1 className="mt-1 font-serif text-3xl">Mi disponibilidad</h1>
          <p className="mt-2 text-sm text-muted-foreground">Horarios semanales · Hora de Bogotá (America/Bogota)</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading || pending !== null || isAccessError(error)} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Actualizar lista</button>
      </div>
      <div className="mb-5 space-y-3">
        {error && <ApiErrorNotice error={error} onRetry={pending === null ? refresh : undefined} />}
        {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Horarios actuales" aria-busy={loading} className="space-y-4">
          {loading ? <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando disponibilidad...</p>
            : blocks?.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card p-6"><h2 className="font-serif text-xl">Aún no tienes horarios</h2><p className="mt-2 text-sm text-muted-foreground">Agrega tu primer bloque de disponibilidad para recibir citas.</p></div>
              : blocks && WEEK_DAYS.map((day) => {
                const dayBlocks = blocks.filter((block) => block.dayOfWeek === day.value).sort((a, b) => a.startTime.localeCompare(b.startTime));
                if (!dayBlocks.length) return null;
                return (
                  <section key={day.value} className="rounded-2xl border border-border bg-card p-5">
                    <h2 className="font-serif text-xl">{day.label}</h2>
                    <ul className="mt-3 divide-y divide-border">
                      {dayBlocks.map((block) => (
                        <li key={block.id} className="py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="font-medium tabular-nums">{block.startTime} – {block.endTime}</p>
                            <button type="button" disabled={disabled} onClick={() => setConfirmId(block.id)} aria-label={`Eliminar horario del ${day.label.toLowerCase()} de ${block.startTime} a ${block.endTime}`} className="min-h-11 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50">Eliminar</button>
                          </div>
                          {confirmId === block.id && (
                            <div className="mt-3 rounded-xl bg-muted p-4">
                              <p className="text-sm">¿Eliminar el horario del {day.label.toLowerCase()} de {block.startTime} a {block.endTime}?</p>
                              <div className="mt-3 flex flex-wrap gap-3">
                                <button type="button" disabled={disabled} onClick={() => void remove(block.id)} className="min-h-11 rounded-xl bg-red-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending === block.id ? 'Eliminando...' : 'Confirmar eliminación'}</button>
                                <button type="button" disabled={pending !== null} onClick={() => setConfirmId(null)} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm">Conservar horario</button>
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
