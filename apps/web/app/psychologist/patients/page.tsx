'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { getClinicalPatients, type ClinicalPatient } from '../../../lib/api';
import { isAccessError, portalError, requireSessionToken } from '../../../lib/psychologist';

// The API returns only patients with an active care relationship for the signed-in psychologist.
export default function PsychologistPatientsPage() {
  const [patients, setPatients] = useState<ClinicalPatient[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getClinicalPatients(requireSessionToken(), 1);
        if (!active) return;
        setPatients(result.items);
        setPage(1);
        setHasMore(result.hasMore);
      } catch (caught) {
        if (!active) return;
        setPatients(null);
        setError(portalError(caught, 'No fue posible cargar tus pacientes. Revisa tu conexión y reintenta.'));
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
    setPatients(null);
    setRevision((value) => value + 1);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await getClinicalPatients(requireSessionToken(), page + 1);
      setPatients((current) => [...(current ?? []), ...next.items]);
      setPage(next.page);
      setHasMore(next.hasMore);
    } catch (caught) {
      const failure = portalError(caught, 'No fue posible cargar más pacientes.');
      if (isAccessError(failure)) setPatients(null);
      setError(failure);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Portal del psicólogo</p>
          <h1 className="mt-1 font-serif text-3xl">Mis pacientes</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">Pacientes que administración te ha asignado. Solo verás tus propias notas clínicas.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading || isAccessError(error)} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Actualizar</button>
      </div>
      {error && <ApiErrorNotice error={error} onRetry={refresh} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />}
      {loading ? (
        <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando pacientes...</p>
      ) : patients?.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-6">
          <h2 className="font-serif text-xl">Aún no tienes pacientes asignados</h2>
          <p className="mt-2 text-sm text-muted-foreground">Cuando administración te asigne un paciente, aparecerá aquí.</p>
        </section>
      ) : patients && (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map((patient) => (
              <li key={patient.id}>
                <Link href={`/psychologist/patients/${encodeURIComponent(patient.id)}`} className="group flex h-full min-h-11 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                  <span className="break-words font-serif text-lg">{patient.fullName?.trim() || 'Paciente sin nombre registrado'}</span>
                  <span className="mt-3 inline-flex items-center text-sm font-medium text-[#47664C] group-hover:underline">Ver seguimiento <span aria-hidden="true" className="ml-2">→</span></span>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-6 min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">
              {loadingMore ? 'Cargando...' : 'Cargar más pacientes'}
            </button>
          )}
        </>
      )}
    </>
  );
}
