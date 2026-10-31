'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiErrorNotice } from '../../../../components/api-error-notice';
import { BackLink, PageIntro } from '../../../../components/app-shell';
import { BookingStep, SummaryRow } from '../../../../components/booking-steps';
import { Icon } from '../../../../components/ui';
import {
  ApiError,
  createDeskAppointment,
  getAvailableSlots,
  getPsychologistWeeklyAvailability,
  getPsychologists,
  searchDeskPatients,
  type DeskPatient,
  type PsychologistOption,
  type PsychologistWeeklyAvailability,
} from '../../../../lib/api';
import {
  NO_SLOTS_MESSAGE,
  WEEK_DAY_LABEL,
  appointmentErrorMessage,
  bookingPsychologistId,
  businessNow,
  formatCalendarDate,
  formatClockTime,
  formatShortDate,
  formatTimeRange,
  sessionEndTime,
  suggestedDates,
} from '../../../../lib/appointments';
import { portalError, withSession } from '../../../../lib/psychologist';
import { BLOCKER_LABEL, deskBookingErrorMessage } from '../../../../lib/staff-desk';

export default function StaffNewAppointmentPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<DeskPatient[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [patient, setPatient] = useState<DeskPatient | null>(null);

  const [psychologists, setPsychologists] = useState<PsychologistOption[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [psychologistId, setPsychologistId] = useState('');
  const [weekly, setWeekly] = useState<PsychologistWeeklyAvailability | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [slotsRevision, setSlotsRevision] = useState(0);
  const [slot, setSlot] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');
  const [today] = useState(() => businessNow().date);

  useEffect(() => {
    let active = true;
    withSession(getPsychologists)
      .then((result) => { if (active) setPsychologists(result); })
      .catch((caught: unknown) => {
        if (active) setLoadError(portalError(caught, 'No fue posible cargar los psicólogos. Revisa tu conexión.'));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!psychologistId) return;
    let active = true;
    withSession((token) => getPsychologistWeeklyAvailability(token, psychologistId))
      .then((result) => { if (active) setWeekly(result); })
      .catch(() => { if (active) setWeekly(null); });
    return () => { active = false; };
  }, [psychologistId]);

  useEffect(() => {
    if (!psychologistId || !date) return;
    let active = true;
    withSession((token) => getAvailableSlots(token, psychologistId, date))
      .then((result) => { if (active) setSlots(result); })
      .catch((caught: unknown) => {
        if (!active) return;
        setSlots(null);
        setSlotsError(appointmentErrorMessage(caught, 'slots'));
      })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [psychologistId, date, slotsRevision]);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const term = search.trim();
    if (term.length < 2) {
      setSearchError('Escribe al menos 2 caracteres para buscar.');
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const found = await withSession((token) => searchDeskPatients(token, term));
      setResults(found.items);
      setHasMore(found.hasMore);
    } catch (caught) {
      setResults(null);
      setSearchError(caught instanceof ApiError ? caught.message : 'No fue posible buscar pacientes. Revisa tu conexión.');
    } finally {
      setSearching(false);
    }
  }

  function choosePatient(value: DeskPatient) {
    if (!value.canBook) return;
    setPatient(value);
    setBookError('');
  }

  function choosePsychologist(value: string) {
    setPsychologistId(value);
    setWeekly(null);
    setDate('');
    resetSlots(false);
  }

  function chooseDate(value: string) {
    setDate(value);
    resetSlots(Boolean(psychologistId && value));
  }

  function resetSlots(willLoad: boolean) {
    setSlots(null);
    setSlot('');
    setSlotsError('');
    setSlotsLoading(willLoad);
  }

  async function confirm() {
    if (!patient || !psychologistId || !date || !slot) return;
    setBooking(true);
    setBookError('');
    try {
      await withSession((token) => createDeskAppointment(token, {
        patientId: patient.id,
        psychologistId,
        appointmentDate: date,
        startTime: slot,
      }));
      router.push('/staff/dashboard?agendada=1');
    } catch (caught) {
      setBookError(deskBookingErrorMessage(caught));
      if (caught instanceof ApiError && (caught.status === 409 || caught.status === 400)) {
        resetSlots(true);
        setSlotsRevision((value) => value + 1);
      }
      setBooking(false);
    }
  }

  const selected = psychologists?.find((item) => bookingPsychologistId(item) === psychologistId);
  const workingDays = weekly?.availability.filter((block) => block.isActive) ?? [];
  const suggestions = suggestedDates([...new Set(workingDays.map((block) => block.dayOfWeek))], today);
  const step = !patient ? 1 : !psychologistId ? 2 : !date ? 3 : !slot ? 4 : 5;

  return (
    <>
      <BackLink href="/staff/dashboard">Agenda de psicólogos</BackLink>
      <PageIntro kicker="Recepción" title="Agendar cita para un paciente" description="Sesiones de 60 minutos. Se aplican las mismas reglas que cuando el paciente agenda: disponibilidad, cruces de horario, perfil completo y autorización de datos." />

      {loadError ? (
        <ApiErrorNotice error={loadError} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="space-y-4">
            <BookingStep number={1} current={step} title="Busca al paciente">
              <form onSubmit={(event) => void runSearch(event)} className="flex flex-col gap-2 sm:flex-row" role="search">
                <label htmlFor="patient-search" className="sr-only">Buscar paciente</label>
                <input id="patient-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nombre, número de registro, correo o teléfono" maxLength={80} autoComplete="off" className="field flex-1" />
                <button type="submit" disabled={searching} className="btn btn-primary"><Icon name="users" size={18} />{searching ? 'Buscando...' : 'Buscar'}</button>
              </form>
              {searchError && <p role="alert" className="mt-3 text-sm text-red-800">{searchError}</p>}
              {results && results.length === 0 && (
                <p className="mt-3 rounded-xl border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
                  No se encontraron pacientes. El paciente debe registrarse primero en la aplicación.
                </p>
              )}
              {results && results.length > 0 && (
                <ul className="mt-4 grid gap-3" role="radiogroup" aria-label="Paciente">
                  {results.map((item) => (
                    <li key={item.id}>
                      <button type="button" role="radio" aria-checked={patient?.id === item.id} aria-disabled={!item.canBook}
                        onClick={() => choosePatient(item)}
                        className={`flex w-full flex-col gap-1 rounded-xl border p-3 text-left transition ${item.canBook ? 'border-border bg-background hover:border-forest aria-checked:border-forest aria-checked:bg-mint aria-checked:ring-2 aria-checked:ring-forest/25' : 'cursor-not-allowed border-dashed border-border bg-muted/40 text-muted-foreground'}`}>
                        <span className="break-words font-medium">{item.fullName?.trim() || 'Sin nombre registrado'} <span className="text-xs font-normal text-muted-foreground">{item.mrn}</span></span>
                        <span className="break-all text-xs text-muted-foreground">{item.email}{item.phone ? ` · ${item.phone}` : ''}</span>
                        {!item.canBook && (
                          <span className="mt-1 text-xs text-amber-900">
                            {item.blockers.map((blocker) => BLOCKER_LABEL[blocker]).join(' ')}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {hasMore && <p className="mt-2 text-xs text-muted-foreground">Hay más resultados: escribe una búsqueda más específica.</p>}
            </BookingStep>

            <BookingStep number={2} current={step} title="Elige el psicólogo">
              {!patient ? (
                <p className="text-sm text-muted-foreground">Primero selecciona un paciente.</p>
              ) : !psychologists ? (
                <p role="status" className="text-sm text-muted-foreground">Cargando psicólogos...</p>
              ) : psychologists.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay psicólogos disponibles en este momento.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Psicólogo">
                  {psychologists.map((item) => {
                    const value = bookingPsychologistId(item);
                    return (
                      <button key={item.id} type="button" role="radio" aria-checked={psychologistId === value} onClick={() => choosePsychologist(value)}
                        className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition hover:border-forest aria-checked:border-forest aria-checked:bg-mint aria-checked:ring-2 aria-checked:ring-forest/25">
                        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest font-serif text-lg text-white">{item.fullName.trim()[0]?.toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block break-words font-medium">{item.fullName}</span>
                          {item.position && <span className="block text-xs text-muted-foreground">{item.position}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </BookingStep>

            <BookingStep number={3} current={step} title="Elige la fecha">
              {!psychologistId ? (
                <p className="text-sm text-muted-foreground">Primero selecciona un psicólogo.</p>
              ) : (
                <div className="space-y-4">
                  {weekly && (
                    <p className="rounded-xl bg-background px-3 py-2 text-sm text-muted-foreground">
                      {workingDays.length === 0
                        ? 'Este psicólogo aún no ha publicado horarios de atención.'
                        : <>Atiende: {workingDays.map((block) => `${WEEK_DAY_LABEL[block.dayOfWeek]} ${formatTimeRange(block.startTime, block.endTime)}`).join(' · ')}</>}
                    </p>
                  )}
                  {suggestions.length > 0 && (
                    <div>
                      <p className="field-label">Próximas fechas con atención</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {suggestions.map((value) => (
                          <button key={value} type="button" aria-pressed={date === value} onClick={() => chooseDate(value)}
                            className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium first-letter:uppercase transition hover:border-forest aria-pressed:border-forest aria-pressed:bg-mint aria-pressed:ring-2 aria-pressed:ring-forest/25">
                            {formatShortDate(value)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:max-w-xs">
                    <label htmlFor="desk-booking-date" className="field-label">O elige otra fecha</label>
                    <input id="desk-booking-date" type="date" min={today} value={date} onChange={(event) => chooseDate(event.target.value)} className="field" />
                  </div>
                </div>
              )}
            </BookingStep>

            <BookingStep number={4} current={step} title="Elige la hora">
              {!psychologistId || !date ? (
                <p className="text-sm text-muted-foreground">Selecciona psicólogo y fecha para ver los horarios.</p>
              ) : slotsLoading ? (
                <p role="status" className="text-sm text-muted-foreground">Consultando horarios...</p>
              ) : slotsError ? (
                <p role="alert" className="text-sm text-red-800">{slotsError}</p>
              ) : slots && slots.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
                  {NO_SLOTS_MESSAGE}{suggestions.length > 0 && ' Prueba con una de las fechas sugeridas.'}
                </p>
              ) : slots && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" role="radiogroup" aria-label="Hora">
                  {slots.map((item) => (
                    <button key={item} type="button" role="radio" aria-checked={slot === item} onClick={() => { setSlot(item); setBookError(''); }}
                      className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium tabular-nums transition hover:border-forest aria-checked:border-forest aria-checked:bg-forest aria-checked:text-white">
                      {formatClockTime(item)}
                    </button>
                  ))}
                </div>
              )}
            </BookingStep>
          </div>

          <aside className="surface p-5 sm:p-6 lg:sticky lg:top-24" aria-labelledby="desk-booking-summary">
            <h2 id="desk-booking-summary" className="font-serif text-xl">Resumen</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <SummaryRow label="Paciente" value={patient ? `${patient.fullName?.trim() || 'Sin nombre'} (${patient.mrn})` : undefined} />
              <SummaryRow label="Psicólogo" value={selected?.fullName} />
              <SummaryRow label="Fecha" value={date ? formatCalendarDate(date) : undefined} capitalize />
              <SummaryRow label="Hora" value={slot ? formatTimeRange(slot, sessionEndTime(slot)) : undefined} />
            </dl>
            {bookError && <p role="alert" className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{bookError}</p>}
            <button type="button" onClick={() => void confirm()} disabled={!patient || !slot || booking} className="btn btn-primary mt-5 w-full">
              {booking ? 'Agendando...' : 'Confirmar cita'}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">El paciente y el psicólogo reciben la confirmación por correo y, si las activaron, por notificación.</p>
          </aside>
        </div>
      )}
    </>
  );
}
