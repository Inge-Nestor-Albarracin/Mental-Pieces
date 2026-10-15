'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiErrorNotice } from '../../../components/api-error-notice';
import { BackLink, PageIntro } from '../../../components/app-shell';
import {
  ApiError,
  createAppointment,
  getAvailableSlots,
  getPsychologistWeeklyAvailability,
  getPsychologists,
  type PsychologistOption,
  type PsychologistWeeklyAvailability,
} from '../../../lib/api';
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
} from '../../../lib/appointments';
import { portalError, withSession } from '../../../lib/psychologist';

export default function NewAppointmentPage() {
  const router = useRouter();
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

  // Weekly schedule of the selected psychologist: explains which days have slots.
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
    if (!psychologistId || !date || !slot) return;
    setBooking(true);
    setBookError('');
    try {
      await withSession((token) => createAppointment(token, { psychologistId, appointmentDate: date, startTime: slot }));
      router.push('/appointments?agendada=1');
    } catch (caught) {
      setBookError(appointmentErrorMessage(caught, 'book'));
      // A taken slot or one that just passed: reload what is really available.
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
  const step = !psychologistId ? 1 : !date ? 2 : !slot ? 3 : 4;

  return (
    <>
      <BackLink href="/appointments">Mis citas</BackLink>
      <PageIntro kicker="Nueva cita" title="Agendar cita" description="Sesiones de 60 minutos. Todas las horas están en hora de Colombia (Bogotá)." />

      {loadError ? (
        <ApiErrorNotice error={loadError} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} />
      ) : !psychologists ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando psicólogos...</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="space-y-4">
            <Step number={1} current={step} title="Elige tu psicólogo">
              {psychologists.length === 0 ? (
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
            </Step>

            <Step number={2} current={step} title="Elige la fecha">
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
                    <label htmlFor="booking-date" className="field-label">O elige otra fecha</label>
                    {/* `min` is a UX hint only; the API rejects past dates and times. */}
                    <input id="booking-date" type="date" min={today} value={date} onChange={(event) => chooseDate(event.target.value)} className="field" />
                  </div>
                </div>
              )}
            </Step>

            <Step number={3} current={step} title="Elige la hora">
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
            </Step>
          </div>

          <aside className="surface p-5 sm:p-6 lg:sticky lg:top-24" aria-labelledby="booking-summary">
            <h2 id="booking-summary" className="font-serif text-xl">Resumen</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <SummaryRow label="Psicólogo" value={selected?.fullName} />
              <SummaryRow label="Fecha" value={date ? formatCalendarDate(date) : undefined} capitalize />
              <SummaryRow label="Hora" value={slot ? formatTimeRange(slot, sessionEndTime(slot)) : undefined} />
            </dl>
            {bookError && <p role="alert" className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{bookError}</p>}
            <button type="button" onClick={() => void confirm()} disabled={!slot || booking} className="btn btn-primary mt-5 w-full">
              {booking ? 'Agendando...' : 'Confirmar cita'}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Podrás cancelar o reagendar desde Mis citas antes de que comience la sesión.</p>
          </aside>
        </div>
      )}
    </>
  );
}

function Step({ number, current, title, children }: { number: number; current: number; title: string; children: ReactNode }) {
  const done = current > number;
  return (
    <section className={`surface p-5 sm:p-6 ${current === number ? 'ring-2 ring-forest/20' : ''}`} aria-labelledby={`step-${number}`}>
      <h2 id={`step-${number}`} className="mb-4 flex items-center gap-3 font-serif text-lg">
        <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-sans text-sm font-semibold ${done ? 'bg-forest text-white' : current === number ? 'border-2 border-primary text-forest' : 'border border-border text-muted-foreground'}`}>
          {done ? '✓' : number}
        </span>
        {title}
        {done && <span className="sr-only">(completado)</span>}
      </h2>
      {children}
    </section>
  );
}

function SummaryRow({ label, value, capitalize = false }: { label: string; value?: string; capitalize?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${value ? `font-medium text-foreground ${capitalize ? 'first-letter:uppercase' : ''}` : 'italic text-muted-foreground'}`}>{value ?? 'Sin seleccionar'}</dd>
    </div>
  );
}
