'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ApiErrorNotice } from '../../../components/api-error-notice';
import { AppHeader } from '../../../components/app-header';
import { RoleGate } from '../../../components/role-gate';
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
  formatTimeRange,
} from '../../../lib/appointments';
import { portalError, requireSessionToken } from '../../../lib/psychologist';

const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export default function NewAppointmentPage() {
  return (
    <RoleGate role="PATIENT">
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10"><BookingFlow /></main>
      </div>
    </RoleGate>
  );
}

function BookingFlow() {
  const router = useRouter();
  const [psychologists, setPsychologists] = useState<PsychologistOption[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [psychologistId, setPsychologistId] = useState('');
  const [weekly, setWeekly] = useState<PsychologistWeeklyAvailability | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [slot, setSlot] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');
  const [today] = useState(() => businessNow().date);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getPsychologists(requireSessionToken());
        if (active) setPsychologists(result);
      } catch (caught) {
        if (active) setLoadError(portalError(caught, 'No fue posible cargar los psicólogos. Revisa tu conexión.'));
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  // Weekly schedule of the selected psychologist, to explain which days have slots.
  useEffect(() => {
    if (!psychologistId) return;
    let active = true;
    getPsychologistWeeklyAvailability(requireSessionToken(), psychologistId)
      .then((result) => { if (active) setWeekly(result); })
      .catch(() => { if (active) setWeekly(null); });
    return () => { active = false; };
  }, [psychologistId]);

  useEffect(() => {
    if (!psychologistId || !date) return;
    let active = true;
    getAvailableSlots(requireSessionToken(), psychologistId, date)
      .then((result) => { if (active) setSlots(result); })
      .catch((caught: unknown) => {
        if (!active) return;
        setSlots(null);
        setSlotsError(appointmentErrorMessage(caught, 'slots'));
      })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [psychologistId, date]);

  function choosePsychologist(value: string) {
    setPsychologistId(value);
    setWeekly(null);
    resetSlots(Boolean(value && date));
  }

  function chooseDate(value: string) {
    setDate(value);
    resetSlots(Boolean(psychologistId && value));
  }

  function resetSlots(willLoad: boolean) {
    setSlots(null);
    setSlot('');
    setSlotsError('');
    setBookError('');
    setSlotsLoading(willLoad);
  }

  async function confirm() {
    if (!psychologistId || !date || !slot) return;
    setBooking(true);
    setBookError('');
    try {
      await createAppointment(requireSessionToken(), { psychologistId, appointmentDate: date, startTime: slot });
      router.push('/appointments?agendada=1');
    } catch (caught) {
      setBookError(appointmentErrorMessage(caught, 'book'));
      // A taken slot or a slot that just passed: refresh what is really available.
      if (caught instanceof ApiError && (caught.status === 409 || caught.status === 400)) resetSlots(true);
      setBooking(false);
    }
  }

  const selected = psychologists?.find((item) => bookingPsychologistId(item) === psychologistId);
  const workingDays = weekly?.availability.filter((block) => block.isActive) ?? [];

  return (
    <>
      <Link href="/appointments" className="inline-flex min-h-11 items-center text-sm font-medium text-[#47664C] hover:underline">
        <span aria-hidden="true" className="mr-2">←</span> Mis citas
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Agendar cita</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sesiones de 60 minutos. Todas las horas están en hora de Colombia (Bogotá).</p>

      {loadError ? (
        <div className="mt-6"><ApiErrorNotice error={loadError} messages={{ 404: 'No fue posible encontrar el recurso solicitado.' }} /></div>
      ) : !psychologists ? (
        <p role="status" className="mt-6 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando psicólogos...</p>
      ) : (
        <section className="mt-6 space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="booking-psychologist" className="text-sm font-medium">1. Psicólogo</label>
              <select id="booking-psychologist" className={inputClass} value={psychologistId} onChange={(event) => choosePsychologist(event.target.value)}>
                <option value="">Selecciona un psicólogo</option>
                {psychologists.map((item) => (
                  <option key={item.id} value={bookingPsychologistId(item)}>{item.fullName}</option>
                ))}
              </select>
              {psychologists.length === 0 && <p className="text-xs text-muted-foreground">No hay psicólogos disponibles en este momento.</p>}
              {weekly && (
                <p className="text-xs text-muted-foreground">
                  {workingDays.length === 0
                    ? 'Este psicólogo aún no ha publicado horarios de atención.'
                    : `Atiende: ${workingDays.map((block) => `${WEEK_DAY_LABEL[block.dayOfWeek]} ${formatTimeRange(block.startTime, block.endTime)}`).join(' · ')}.`}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="booking-date" className="text-sm font-medium">2. Fecha</label>
              {/* `min` is only a UX hint; the API rejects past dates and times. */}
              <input id="booking-date" type="date" min={today} value={date} disabled={!psychologistId} onChange={(event) => chooseDate(event.target.value)} className={inputClass} />
              {date && <p className="text-xs capitalize text-muted-foreground">{formatCalendarDate(date)}</p>}
            </div>
          </div>

          <fieldset className="min-w-0">
            <legend className="text-sm font-medium">3. Hora</legend>
            {!psychologistId || !date ? (
              <p className="mt-2 text-sm text-muted-foreground">Selecciona psicólogo y fecha para ver los horarios.</p>
            ) : slotsLoading ? (
              <p role="status" className="mt-2 text-sm text-muted-foreground">Consultando horarios...</p>
            ) : slotsError ? (
              <p role="alert" className="mt-2 text-sm text-red-800">{slotsError}</p>
            ) : slots && slots.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">{NO_SLOTS_MESSAGE}</p>
            ) : slots && (
              <div className="mt-2 flex flex-wrap gap-2">
                {slots.map((item) => (
                  <button key={item} type="button" aria-pressed={slot === item} onClick={() => { setSlot(item); setBookError(''); }}
                    className="min-h-11 rounded-xl border border-border bg-white px-3 py-2 text-sm font-medium transition hover:bg-background aria-pressed:border-primary aria-pressed:bg-[#EEF4EF] aria-pressed:ring-2 aria-pressed:ring-primary/30">
                    {formatClockTime(item)}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {slot && selected && (
            <div className="rounded-xl border border-[#C9DACB] bg-[#EEF4EF] p-4 text-sm">
              <p className="font-medium">Confirma tu cita</p>
              <p className="mt-1">{selected.fullName}</p>
              <p className="capitalize">{formatCalendarDate(date)}</p>
              <p>{formatTimeRange(slot, `${String(Number(slot.slice(0, 2)) + 1).padStart(2, '0')}:${slot.slice(3)}`)}</p>
            </div>
          )}

          {bookError && <p role="alert" className="text-sm text-red-800">{bookError}</p>}

          <button type="button" onClick={() => void confirm()} disabled={!slot || booking}
            className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#587A5E] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
            {booking ? 'Agendando...' : 'Confirmar cita'}
          </button>
        </section>
      )}
    </>
  );
}
