'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { PageIntro } from '../../../components/app-shell';
import { EmptyState, Icon } from '../../../components/ui';
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
      <PageIntro
        kicker="Portal del psicólogo"
        title="Mis pacientes"
        description="Pacientes que administración te ha asignado. Solo verás tus propias notas clínicas."
        actions={<button type="button" onClick={refresh} disabled={loading || isAccessError(error)} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar</button>}
      />
      {error && <ApiErrorNotice error={error} onRetry={refresh} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />}
      {loading ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando pacientes...</p>
      ) : patients?.length === 0 ? (
        <EmptyState icon="users" title="Aún no tienes pacientes asignados" text="Cuando administración te asigne un paciente, aparecerá aquí." />
      ) : patients && (
        <>
          <p className="mb-4 text-sm text-ink-soft">{patients.length}{hasMore ? '+' : ''} {patients.length === 1 ? 'paciente asignado' : 'pacientes asignados'}</p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map((patient) => {
              const name = patient.fullName?.trim() || 'Paciente sin nombre registrado';
              return (
                <li key={patient.id}>
                  <Link href={`/psychologist/patients/${encodeURIComponent(patient.id)}`} className="quick-card group h-full">
                    <span aria-hidden="true" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-forest font-serif text-xl text-white">{name[0]?.toUpperCase()}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <strong className="break-words text-[15px] text-foreground">{name}</strong>
                      <small className="inline-flex items-center gap-1.5 text-xs text-ink-soft"><Icon name="notes" size={14} />Ver seguimiento y notas</small>
                    </span>
                    <span className="text-primary transition group-hover:translate-x-1"><Icon name="arrow" size={18} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn btn-quiet mt-6">
              {loadingMore ? 'Cargando...' : 'Cargar más pacientes'}
            </button>
          )}
        </>
      )}
    </>
  );
}
