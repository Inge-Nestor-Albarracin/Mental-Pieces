'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiErrorNotice } from '../../../../components/api-error-notice';
import { BackLink } from '../../../../components/app-shell';
import { EmptyState, Eyebrow, Icon, StatusPill } from '../../../../components/ui';
import {
  ApiError,
  createClinicalNote,
  getClinicalNotes,
  getClinicalPatients,
  getPsychologistAppointments,
  type ClinicalNote,
  type PsychologistAppointment,
} from '../../../../lib/api';
import {
  CLINICAL_ACCESS_DENIED,
  NOTE_MAX_LENGTH,
  completedAppointmentsFor,
  noteErrorMessage,
  revokesClinicalAccess,
} from '../../../../lib/clinical';
import { portalError, requireSessionToken } from '../../../../lib/psychologist';

// Clinical data lives only in component state: never storage, never logs.

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  }).format(new Date(value));
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
  }).format(new Date(`${date}T12:00:00-05:00`));
}

function appointmentLabel(appointment: PsychologistAppointment) {
  return `${formatDate(appointment.appointmentDate)} · ${appointment.startTime} – ${appointment.endTime}`;
}

export default function PatientClinicalPage() {
  const params = useParams<{ patientId: string }>();
  const patientId = typeof params.patientId === 'string' ? params.patientId : '';

  const [patientName, setPatientName] = useState<string | null>(null);
  const [notes, setNotes] = useState<ClinicalNote[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [completed, setCompleted] = useState<PsychologistAppointment[]>([]);
  const [appointmentsUnavailable, setAppointmentsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [revision, setRevision] = useState(0);

  const [content, setContent] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  // Wipe everything clinical as soon as the server says access is gone.
  const revokeAccess = useCallback((caught: unknown) => {
    setNotes(null);
    setPatientName(null);
    setCompleted([]);
    setContent('');
    setAppointmentId('');
    setHasMore(false);
    setSuccess('');
    setFormError('');
    setRevoked(true);
    setError(caught instanceof ApiError && caught.status !== 404
      ? caught
      : new ApiError(404, CLINICAL_ACCESS_DENIED));
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const token = requireSessionToken();
        const notePage = await getClinicalNotes(token, patientId, 1);
        if (!active) return;
        setNotes(notePage.items);
        setPage(1);
        setHasMore(notePage.hasMore);
        setRevoked(false);
        setError(null);

        // Secondary data. Failure here never blocks reading or writing unlinked notes.
        const [agenda, patients] = await Promise.allSettled([
          getPsychologistAppointments(token),
          getClinicalPatients(token, 1),
        ]);
        if (!active) return;
        const appointments = agenda.status === 'fulfilled' ? agenda.value : [];
        setAppointmentsUnavailable(agenda.status === 'rejected');
        setCompleted(completedAppointmentsFor(appointments, patientId));
        const listed = patients.status === 'fulfilled'
          ? patients.value.items.find((item) => item.id === patientId)
          : undefined;
        const fromAgenda = appointments.find((item) => item.patient.id === patientId);
        setPatientName(listed?.fullName?.trim() || fromAgenda?.patient.fullName?.trim() || null);
      } catch (caught) {
        if (!active) return;
        if (revokesClinicalAccess(caught)) revokeAccess(caught);
        else {
          setNotes(null);
          setError(portalError(caught, 'No fue posible cargar las notas clínicas. Revisa tu conexión y reintenta.'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [patientId, revision, revokeAccess]);

  const refresh = useCallback(() => {
    setLoading(true);
    setRevision((value) => value + 1);
  }, []);

  // Re-check access when the tab regains focus, so a revoked relationship stops showing notes.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && !revoked) refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, revoked]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await getClinicalNotes(requireSessionToken(), patientId, page + 1);
      setNotes((current) => [...(current ?? []), ...next.items]);
      setPage(next.page);
      setHasMore(next.hasMore);
    } catch (caught) {
      if (revokesClinicalAccess(caught)) revokeAccess(caught);
      else setError(portalError(caught, 'No fue posible cargar más notas.'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    const trimmed = content.trim();
    if (!trimmed) {
      setFormError('La nota no puede estar vacía.');
      return;
    }
    if (trimmed.length > NOTE_MAX_LENGTH) {
      setFormError(`La nota no puede superar ${NOTE_MAX_LENGTH.toLocaleString('es-CO')} caracteres.`);
      return;
    }
    setSaving(true);
    try {
      const created = await createClinicalNote(requireSessionToken(), patientId, {
        content: trimmed,
        ...(appointmentId ? { appointmentId } : {}),
      });
      setNotes((current) => [created, ...(current ?? [])]);
      setContent('');
      setAppointmentId('');
      setSuccess('Nota clínica guardada.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) setFormError(noteErrorMessage(caught));
      else if (revokesClinicalAccess(caught)) revokeAccess(caught);
      else setFormError(noteErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  const linkedIds = new Set((notes ?? []).map((note) => note.appointmentId).filter(Boolean));
  const selectable = completed.filter((item) => !linkedIds.has(item.id));
  const appointmentsById = new Map(completed.map((item) => [item.id, item]));
  const length = content.trim().length;

  const displayName = revoked ? 'Recurso clínico' : patientName ?? 'Paciente asignado';

  return (
    <>
      <BackLink href="/psychologist/patients">Mis pacientes</BackLink>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {!revoked && <span aria-hidden="true" className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-forest font-serif text-2xl text-white">{displayName[0]?.toUpperCase()}</span>}
          <div className="min-w-0">
            <Eyebrow>Seguimiento clínico</Eyebrow>
            <h1 className="mt-1.5 break-words font-serif text-3xl font-normal tracking-tight sm:text-4xl">{displayName}</h1>
            {!revoked && <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-soft"><Icon name="shield" size={16} className="text-primary" />Solo ves las notas que tú has escrito para este paciente.</p>}
          </div>
        </div>
        {!revoked && (
          <button type="button" onClick={refresh} disabled={loading} className="btn btn-quiet"><Icon name="refresh" size={18} />Actualizar</button>
        )}
      </div>

      {error && (
        <ApiErrorNotice
          error={error}
          onRetry={revoked ? undefined : refresh}
          messages={{ 404: CLINICAL_ACCESS_DENIED }}
        />
      )}

      {loading && !notes && !revoked ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando notas clínicas...</p>
      ) : notes && !revoked && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section aria-labelledby="new-note" className="surface h-fit border-2 border-[rgba(54,91,69,0.22)] p-5 sm:p-6 lg:sticky lg:top-24">
            <Eyebrow>Nueva nota</Eyebrow>
            <h2 id="new-note" className="mt-1.5 flex items-center gap-2 font-serif text-2xl"><Icon name="edit" size={21} className="text-forest" />Nota de sesión</h2>
            <form onSubmit={submit} className="mt-5">
              <fieldset disabled={saving} className="space-y-4">
                <legend className="sr-only">Crear nota clínica</legend>
                <div className="flex flex-col gap-2">
                  <label htmlFor="note-content" className="field-label">Contenido de la nota</label>
                  <textarea
                    id="note-content"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    rows={8}
                    maxLength={NOTE_MAX_LENGTH + 200}
                    required
                    aria-describedby="note-counter"
                    autoComplete="off"
                    className="field min-h-48 leading-relaxed"
                  />
                  <p id="note-counter" aria-live="polite" className={`text-xs tabular-nums ${length > NOTE_MAX_LENGTH ? 'font-semibold text-red-800' : 'text-ink-soft'}`}>
                    {length.toLocaleString('es-CO')} / {NOTE_MAX_LENGTH.toLocaleString('es-CO')} caracteres
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="note-appointment" className="field-label">Vincular a una cita realizada (opcional)</label>
                  <select id="note-appointment" value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)} className="field">
                    <option value="">Sin vincular a una cita</option>
                    {selectable.map((item) => <option key={item.id} value={item.id}>{appointmentLabel(item)}</option>)}
                  </select>
                  <p className="text-xs text-ink-soft">
                    {appointmentsUnavailable
                      ? 'No fue posible cargar tus citas. Puedes guardar la nota sin vincularla.'
                      : selectable.length === 0
                        ? 'No hay citas realizadas disponibles para vincular con este paciente.'
                        : 'Solo se muestran tus citas realizadas con este paciente que aún no tienen nota.'}
                  </p>
                </div>
                {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>}
                {success && <p role="status" className="flex items-center gap-2 rounded-xl bg-mint px-3 py-2 text-sm text-forest-deep"><Icon name="check" size={17} />{success}</p>}
                <button type="submit" disabled={saving || length === 0 || length > NOTE_MAX_LENGTH} className="btn btn-primary w-full">
                  <Icon name="check" size={18} />{saving ? 'Guardando...' : 'Guardar nota'}
                </button>
              </fieldset>
            </form>
          </section>

          <section aria-labelledby="notes-title" className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <Eyebrow>Historial</Eyebrow>
                <h2 id="notes-title" className="mt-1.5 font-serif text-2xl">Mis notas</h2>
              </div>
              <StatusPill tone="gray">{notes.length}{hasMore ? '+' : ''} {notes.length === 1 ? 'nota' : 'notas'}</StatusPill>
            </div>
            {notes.length === 0 ? (
              <EmptyState icon="notes" title="Sin notas todavía" text="Aún no has registrado notas para este paciente." />
            ) : (
              <ol className="relative space-y-4 border-l-2 border-[rgba(54,91,69,0.18)] pl-5">
                {notes.map((note) => {
                  const linked = note.appointmentId ? appointmentsById.get(note.appointmentId) : undefined;
                  return (
                    <li key={note.id} className="relative rounded-[18px] border border-[rgba(54,91,69,0.13)] bg-paper p-5 shadow-[var(--shadow-soft)]">
                      <span aria-hidden="true" className="absolute -left-[29px] top-6 h-3.5 w-3.5 rounded-full border-2 border-paper bg-forest" />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft"><Icon name="clock" size={14} /><time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time></span>
                        {note.appointmentId && (
                          <StatusPill tone="violet">{linked ? `Cita del ${appointmentLabel(linked)}` : 'Vinculada a una cita realizada'}</StatusPill>
                        )}
                      </div>
                      {note.updatedAt !== note.createdAt && <p className="mt-1 text-xs text-ink-soft">Actualizada {formatDateTime(note.updatedAt)}</p>}
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{note.content}</p>
                    </li>
                  );
                })}
              </ol>
            )}
            {hasMore && (
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn btn-quiet mt-4">
                {loadingMore ? 'Cargando...' : 'Cargar notas anteriores'}
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
