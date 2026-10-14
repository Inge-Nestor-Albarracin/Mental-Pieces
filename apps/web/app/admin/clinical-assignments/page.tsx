'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import {
  createCareAssignment,
  endCareAssignment,
  getAssignablePatients,
  getCareAssignments,
  getPsychologists,
  type AssignablePatient,
  type CareAssignment,
  type PsychologistOption,
} from '../../../lib/api';
import { ASSIGNMENT_EXISTS, assignmentErrorMessage } from '../../../lib/clinical';
import { isAccessError, portalError, requireSessionToken } from '../../../lib/psychologist';

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  }).format(new Date(value));
}

const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export default function ClinicalAssignmentsPage() {
  const [patients, setPatients] = useState<AssignablePatient[]>([]);
  const [patientsPage, setPatientsPage] = useState(1);
  const [patientsHasMore, setPatientsHasMore] = useState(false);
  const [psychologists, setPsychologists] = useState<PsychologistOption[]>([]);
  const [assignments, setAssignments] = useState<CareAssignment[]>([]);
  const [assignmentsPage, setAssignmentsPage] = useState(1);
  const [assignmentsHasMore, setAssignmentsHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  const [patientId, setPatientId] = useState('');
  const [psychologistId, setPsychologistId] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endError, setEndError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const token = requireSessionToken();
        const [patientPage, psychologistList, assignmentPage] = await Promise.all([
          getAssignablePatients(token, 1),
          getPsychologists(token),
          getCareAssignments(token, 1),
        ]);
        if (!active) return;
        setPatients(patientPage.items);
        setPatientsPage(1);
        setPatientsHasMore(patientPage.hasMore);
        setPsychologists(psychologistList);
        setAssignments(assignmentPage.items);
        setAssignmentsPage(1);
        setAssignmentsHasMore(assignmentPage.hasMore);
      } catch (caught) {
        if (!active) return;
        setPatients([]);
        setPsychologists([]);
        setAssignments([]);
        setError(portalError(caught, 'No fue posible cargar las asignaciones. Revisa tu conexión y reintenta.'));
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
    setConfirmingId(null);
    setRevision((value) => value + 1);
  }

  function handleAccessLoss(caught: unknown): boolean {
    const failure = portalError(caught, '');
    if (!isAccessError(failure)) return false;
    setPatients([]);
    setPsychologists([]);
    setAssignments([]);
    setError(failure);
    return true;
  }

  async function loadMore(kind: 'patients' | 'assignments') {
    setLoadingMore(true);
    try {
      const token = requireSessionToken();
      if (kind === 'patients') {
        const next = await getAssignablePatients(token, patientsPage + 1);
        setPatients((current) => [...current, ...next.items]);
        setPatientsPage(next.page);
        setPatientsHasMore(next.hasMore);
      } else {
        const next = await getCareAssignments(token, assignmentsPage + 1);
        setAssignments((current) => [...current, ...next.items]);
        setAssignmentsPage(next.page);
        setAssignmentsHasMore(next.hasMore);
      }
    } catch (caught) {
      if (!handleAccessLoss(caught)) setError(portalError(caught, 'No fue posible cargar más resultados.'));
    } finally {
      setLoadingMore(false);
    }
  }

  const duplicate = assignments.find((item) =>
    item.patient.id === patientId && item.psychologist.id === psychologistId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    if (!patientId || !psychologistId) {
      setFormError('Selecciona un paciente y un psicólogo.');
      return;
    }
    if (duplicate) {
      setFormError(ASSIGNMENT_EXISTS);
      return;
    }
    setCreating(true);
    try {
      await createCareAssignment(requireSessionToken(), { patientId, psychologistId });
      setPatientId('');
      setPsychologistId('');
      setSuccess('Asignación creada correctamente.');
      refresh();
    } catch (caught) {
      if (!handleAccessLoss(caught)) setFormError(assignmentErrorMessage(caught, 'create'));
    } finally {
      setCreating(false);
    }
  }

  async function endAssignment(id: string) {
    setEndingId(id);
    setEndError('');
    setSuccess('');
    try {
      await endCareAssignment(requireSessionToken(), id);
      setSuccess('La relación clínica se finalizó. El psicólogo ya no podrá acceder a este paciente.');
      refresh();
    } catch (caught) {
      if (!handleAccessLoss(caught)) {
        setEndError(assignmentErrorMessage(caught, 'end'));
        setConfirmingId(null);
      }
    } finally {
      setEndingId(null);
    }
  }

  const active = assignments.filter((item) => item.isActive);
  const ended = assignments.filter((item) => !item.isActive);
  const blocked = loading || isAccessError(error);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Administración</p>
          <h1 className="mt-1 font-serif text-3xl">Asignaciones clínicas</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Asignar un paciente autoriza al psicólogo a crear y consultar sus propias notas de ese paciente. Esta vista no muestra contenido clínico.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={blocked} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Actualizar</button>
      </div>

      {error && <ApiErrorNotice error={error} onRetry={refresh} messages={{ 404: 'No fue posible encontrar el recurso solicitado.', 409: 'La operación entró en conflicto. Actualiza e intenta de nuevo.' }} />}
      {success && <p role="status" className="mb-4 rounded-xl border border-[#C9DACB] bg-[#EEF4EF] p-4 text-sm text-[#38543D]">{success}</p>}

      {loading ? (
        <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando asignaciones...</p>
      ) : isAccessError(error) ? null : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section aria-labelledby="new-assignment" className="h-fit rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 id="new-assignment" className="font-serif text-xl">Nueva asignación</h2>
            <form onSubmit={submit} className="mt-5">
              <fieldset disabled={creating} className="space-y-4">
                <legend className="sr-only">Asignar paciente a psicólogo</legend>
                <div className="flex flex-col gap-2">
                  <label htmlFor="assignment-patient" className="text-sm font-medium">Paciente</label>
                  <select id="assignment-patient" className={inputClass} value={patientId} onChange={(event) => setPatientId(event.target.value)} required>
                    <option value="">Selecciona un paciente</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {(patient.fullName?.trim() || 'Paciente sin nombre')} · {patient.mrn}
                      </option>
                    ))}
                  </select>
                  {patients.length === 0 && <p className="text-xs text-muted-foreground">No hay pacientes activos registrados.</p>}
                  {patientsHasMore && (
                    <button type="button" onClick={() => void loadMore('patients')} disabled={loadingMore} className="min-h-11 w-fit text-sm font-medium text-[#47664C] underline disabled:opacity-50">
                      {loadingMore ? 'Cargando...' : 'Cargar más pacientes'}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="assignment-psychologist" className="text-sm font-medium">Psicólogo</label>
                  <select id="assignment-psychologist" className={inputClass} value={psychologistId} onChange={(event) => setPsychologistId(event.target.value)} required>
                    <option value="">Selecciona un psicólogo</option>
                    {psychologists.map((psychologist) => (
                      <option key={psychologist.user.id} value={psychologist.user.id}>{psychologist.fullName}</option>
                    ))}
                  </select>
                  {psychologists.length === 0 && <p className="text-xs text-muted-foreground">No hay psicólogos activos registrados.</p>}
                </div>
                {duplicate && !formError && (
                  <p className="text-sm text-amber-900">
                    Esta pareja ya tiene una relación {duplicate.isActive ? 'activa' : 'finalizada'}.
                  </p>
                )}
                {formError && <p role="alert" className="text-sm text-red-800">{formError}</p>}
                <button type="submit" disabled={creating || !patientId || !psychologistId} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#587A5E] disabled:cursor-not-allowed disabled:opacity-60">
                  {creating ? 'Asignando...' : 'Asignar paciente'}
                </button>
              </fieldset>
            </form>
          </section>

          <div className="min-w-0 space-y-6">
            {endError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{endError}</p>}
            <AssignmentList
              title="Relaciones activas"
              empty="No hay relaciones activas."
              items={active}
              confirmingId={confirmingId}
              endingId={endingId}
              onAskEnd={(id) => { setEndError(''); setConfirmingId(id); }}
              onCancelEnd={() => setConfirmingId(null)}
              onConfirmEnd={(id) => void endAssignment(id)}
            />
            <AssignmentList title="Relaciones finalizadas" empty="No hay relaciones finalizadas." items={ended} />
            {assignmentsHasMore && (
              <button type="button" onClick={() => void loadMore('assignments')} disabled={loadingMore} className="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">
                {loadingMore ? 'Cargando...' : 'Cargar más relaciones'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AssignmentList({ title, empty, items, confirmingId, endingId, onAskEnd, onCancelEnd, onConfirmEnd }: {
  title: string;
  empty: string;
  items: CareAssignment[];
  confirmingId?: string | null;
  endingId?: string | null;
  onAskEnd?: (id: string) => void;
  onCancelEnd?: () => void;
  onConfirmEnd?: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-serif text-xl">{title} <span className="text-base text-muted-foreground">({items.length})</span></h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {items.map((item) => {
            const patientName = item.patient.fullName?.trim() || 'Paciente sin nombre';
            const psychologistName = item.psychologist.fullName?.trim() || 'Psicólogo sin nombre';
            return (
              <li key={item.id} className="flex flex-col gap-3 py-4">
                <div className="min-w-0">
                  <p className="break-words font-medium">{patientName}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">Psicólogo: {psychologistName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Asignado: {formatDateTime(item.assignedAt)}
                    {item.endedAt && <> · Finalizado: {formatDateTime(item.endedAt)}</>}
                  </p>
                  <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${item.isActive ? 'bg-[#E5EEE6] text-[#38543D]' : 'bg-secondary text-foreground'}`}>
                    {item.isActive ? 'Activa' : 'Finalizada'}
                  </span>
                </div>
                {item.isActive && onAskEnd && (
                  confirmingId === item.id ? (
                    <div role="group" aria-label={`Confirmar finalización de ${patientName}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                      <p>¿Finalizar la relación entre {patientName} y {psychologistName}? El psicólogo perderá el acceso clínico a este paciente. Esta acción no se puede revertir desde aquí.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => onConfirmEnd?.(item.id)} disabled={endingId === item.id} className="min-h-11 rounded-xl bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-60">
                          {endingId === item.id ? 'Finalizando...' : 'Sí, finalizar'}
                        </button>
                        <button type="button" onClick={onCancelEnd} disabled={endingId === item.id} className="min-h-11 rounded-xl border border-border bg-white px-4 py-2 font-medium disabled:opacity-60">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => onAskEnd(item.id)} disabled={Boolean(endingId)} className="min-h-11 w-fit rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50">
                      Finalizar relación
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
