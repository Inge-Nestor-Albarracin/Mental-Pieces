'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiErrorNotice } from '../../../components/api-error-notice';
import { PageIntro } from '../../../components/app-shell';
import { Eyebrow, Icon, Notice, StatusPill } from '../../../components/ui';
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

const inputClass = 'field';

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
      <PageIntro
        kicker="Administración"
        title="Asignaciones clínicas"
        description="Asignar un paciente autoriza al psicólogo a crear y consultar sus propias notas de ese paciente. Esta vista no muestra contenido clínico."
        actions={<button type="button" onClick={refresh} disabled={blocked} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar</button>}
      />

      {error && <ApiErrorNotice error={error} onRetry={refresh} messages={{ 404: 'No fue posible encontrar el recurso solicitado.', 409: 'La operación entró en conflicto. Actualiza e intenta de nuevo.' }} />}
      {success && <Notice tone="success">{success}</Notice>}

      {loading ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando asignaciones...</p>
      ) : isAccessError(error) ? null : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section aria-labelledby="new-assignment" className="surface h-fit border-2 border-[rgba(54,91,69,0.22)] p-5 sm:p-6 lg:sticky lg:top-24">
            <Eyebrow>Nueva relación</Eyebrow>
            <h2 id="new-assignment" className="mt-1.5 flex items-center gap-2 font-serif text-2xl"><Icon name="link" size={21} className="text-forest" />Asignar paciente</h2>
            <form onSubmit={submit} className="mt-5">
              <fieldset disabled={creating} className="space-y-4">
                <legend className="sr-only">Asignar paciente a psicólogo</legend>
                <div className="flex flex-col gap-2">
                  <label htmlFor="assignment-patient" className="field-label">Paciente</label>
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
                    <button type="button" onClick={() => void loadMore('patients')} disabled={loadingMore} className="min-h-11 w-fit text-sm font-medium text-forest underline disabled:opacity-50">
                      {loadingMore ? 'Cargando...' : 'Cargar más pacientes'}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="assignment-psychologist" className="field-label">Psicólogo</label>
                  <select id="assignment-psychologist" className={inputClass} value={psychologistId} onChange={(event) => setPsychologistId(event.target.value)} required>
                    <option value="">Selecciona un psicólogo</option>
                    {psychologists.map((psychologist) => (
                      <option key={psychologist.user.id} value={psychologist.user.id}>{psychologist.fullName}</option>
                    ))}
                  </select>
                  {psychologists.length === 0 && <p className="text-xs text-muted-foreground">No hay psicólogos activos registrados.</p>}
                </div>
                {duplicate && !formError && (
                  <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    <Icon name="alert" size={17} className="mt-0.5 shrink-0" />Esta pareja ya tiene una relación {duplicate.isActive ? 'activa' : 'finalizada'}.
                  </p>
                )}
                {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>}
                <button type="submit" disabled={creating || !patientId || !psychologistId} className="btn btn-primary w-full">
                  <Icon name="link" size={18} />{creating ? 'Asignando...' : 'Asignar paciente'}
                </button>
              </fieldset>
            </form>
          </section>

          <div className="min-w-0 space-y-6">
            {endError && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{endError}</p>}
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
              <button type="button" onClick={() => void loadMore('assignments')} disabled={loadingMore} className="btn btn-quiet">
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
  const activeList = Boolean(onAskEnd);
  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">{title}</h2>
        <StatusPill tone={activeList ? 'green' : 'gray'}>{items.length}</StatusPill>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const patientName = item.patient.fullName?.trim() || 'Paciente sin nombre';
            const psychologistName = item.psychologist.fullName?.trim() || 'Psicólogo sin nombre';
            return (
              <li key={item.id} className={`rounded-2xl border p-4 ${item.isActive ? 'border-[rgba(54,91,69,0.15)] bg-background/60' : 'border-border bg-muted/40'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <p className="flex items-center gap-2 break-words font-semibold"><Icon name="profile" size={17} className="shrink-0 text-primary" />{patientName}</p>
                    <p className="flex items-center gap-2 break-words text-sm text-ink-soft"><Icon name="users" size={17} className="shrink-0" />Psicólogo: {psychologistName}</p>
                    <p className="flex items-center gap-2 text-xs text-ink-soft"><Icon name="calendar" size={15} className="shrink-0" />
                      Asignado: {formatDateTime(item.assignedAt)}
                      {item.endedAt && <> · Finalizado: {formatDateTime(item.endedAt)}</>}
                    </p>
                  </div>
                  <StatusPill tone={item.isActive ? 'green' : 'gray'}>{item.isActive ? 'Activa' : 'Finalizada'}</StatusPill>
                </div>
                {item.isActive && onAskEnd && (
                  confirmingId === item.id ? (
                    <div role="group" aria-label={`Confirmar finalización de ${patientName}`} className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
                      <p className="flex items-start gap-2 font-semibold"><Icon name="alert" size={18} className="mt-0.5 shrink-0" />¿Finalizar la relación entre {patientName} y {psychologistName}?</p>
                      <p className="mt-1">El psicólogo perderá el acceso clínico a este paciente. Esta acción no se puede revertir desde aquí.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => onConfirmEnd?.(item.id)} disabled={endingId === item.id} className="btn btn-danger-solid">
                          {endingId === item.id ? 'Finalizando...' : 'Sí, finalizar'}
                        </button>
                        <button type="button" onClick={onCancelEnd} disabled={endingId === item.id} className="btn btn-quiet">No, mantener activa</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => onAskEnd(item.id)} disabled={Boolean(endingId)} className="btn btn-danger mt-4 w-full sm:w-auto">
                      <Icon name="x" size={17} />Finalizar relación
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
