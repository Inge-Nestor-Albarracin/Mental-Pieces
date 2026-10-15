// Pure date/time helpers for appointments (no runtime imports, testable in Node).
// appointmentDate is a CALENDAR date (YYYY-MM-DD), never an instant: it is formatted
// from its parts in UTC so the browser timezone can never shift the day.
// The browser clock is UX only; the API (America/Bogota) decides what is allowed.

const BUSINESS_TIMEZONE = 'America/Bogota';

export type AppointmentStatus = 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

export interface TimedAppointment {
  appointmentDate: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
}

export interface BusinessNow {
  date: string;
  minute: number;
}

function calendarParts(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? [year, month, day]
    : null;
}

// "miércoles, 14 de octubre de 2026"
export function formatCalendarDate(date: string): string {
  const parts = calendarParts(date);
  if (!parts) return date;
  const [year, month, day] = parts;
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// 480 / "08:00" → "8:00 a. m."
export function formatClockTime(time: string | number): string {
  const total = typeof time === 'number' ? time : timeToMinutes(time);
  return new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(total / 60), total % 60)));
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${formatClockTime(startTime)} – ${formatClockTime(endTime)}`;
}

export function businessNow(now = new Date()): BusinessNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '00';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

function isBefore(date: string, minute: number, now: BusinessNow, inclusive: boolean): boolean {
  return date < now.date || (date === now.date && (inclusive ? minute <= now.minute : minute < now.minute));
}

export function hasStarted(item: TimedAppointment, now: BusinessNow): boolean {
  return isBefore(item.appointmentDate, timeToMinutes(item.startTime), now, true);
}

export function hasEnded(item: TimedAppointment, now: BusinessNow): boolean {
  return isBefore(item.appointmentDate, timeToMinutes(item.endTime), now, true);
}

// UPCOMING = SCHEDULED whose end is still ahead. Everything else is HISTORY,
// including CANCELLED in the future and SCHEDULED in the past.
export function isUpcoming(item: TimedAppointment, now: BusinessNow): boolean {
  return item.status === 'SCHEDULED' && !hasEnded(item, now);
}

export type DisplayStatus =
  | 'SCHEDULED' | 'IN_PROGRESS' | 'PAST_SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

// Presentation only: the database keeps SCHEDULED; nothing is auto-classified.
export function displayStatus(item: TimedAppointment, now: BusinessNow): DisplayStatus {
  if (item.status !== 'SCHEDULED') return item.status;
  if (hasEnded(item, now)) return 'PAST_SCHEDULED';
  return hasStarted(item, now) ? 'IN_PROGRESS' : 'SCHEDULED';
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  SCHEDULED: 'Programada',
  IN_PROGRESS: 'En curso',
  PAST_SCHEDULED: 'Pendiente de cierre',
  COMPLETED: 'Realizada',
  NO_SHOW: 'Inasistencia',
  CANCELLED: 'Cancelada',
};

export const STATUS_STYLE: Record<DisplayStatus, string> = {
  SCHEDULED: 'bg-[#E5EEE6] text-[#38543D]',
  IN_PROGRESS: 'bg-[#E5EEE6] text-[#38543D]',
  PAST_SCHEDULED: 'bg-amber-50 text-amber-900 ring-1 ring-amber-300',
  COMPLETED: 'bg-secondary text-foreground',
  NO_SHOW: 'bg-amber-50 text-amber-900',
  CANCELLED: 'bg-red-50 text-red-800',
};

// Patient may cancel/reschedule only a SCHEDULED appointment that has not started.
export function canPatientModify(item: TimedAppointment, now: BusinessNow): boolean {
  return item.status === 'SCHEDULED' && !hasStarted(item, now);
}

// Psychologist may close (COMPLETED / NO_SHOW) only a SCHEDULED appointment that ended.
export function canPsychologistClose(item: TimedAppointment, now: BusinessNow): boolean {
  return item.status === 'SCHEDULED' && hasEnded(item, now);
}

function chronological(a: TimedAppointment, b: TimedAppointment): number {
  return a.appointmentDate.localeCompare(b.appointmentDate) || a.startTime.localeCompare(b.startTime);
}

// Upcoming: soonest first. History: most recent first.
export function splitAppointments<T extends TimedAppointment>(items: T[], now: BusinessNow) {
  const upcoming = items.filter((item) => isUpcoming(item, now)).sort(chronological);
  const history = items.filter((item) => !isUpcoming(item, now)).sort((a, b) => chronological(b, a));
  return { upcoming, history };
}

function statusOf(error: unknown): number | undefined {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

export const NO_SLOTS_MESSAGE = 'No hay horarios disponibles para esta fecha.';

// Maps API failures to accurate, user-facing Spanish messages.
export function appointmentErrorMessage(
  error: unknown,
  action: 'slots' | 'book' | 'reschedule' | 'cancel' | 'close',
): string {
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : '';
  if (status === 401) return 'Tu sesión no es válida o ha vencido. Inicia sesión de nuevo.';
  if (status === 403) return 'No tienes permiso para realizar esta acción.';
  if (status === 409) return 'El horario dejó de estar disponible. Selecciona otro.';
  if (status === 404) {
    if (action === 'slots' || action === 'book') return 'El psicólogo seleccionado ya no está disponible.';
    return 'La cita ya no existe. Actualiza la lista.';
  }
  if (status === 400) {
    if (/pasada|futuro|anterior a hoy/i.test(message))
      return action === 'reschedule'
        ? 'No puedes reagendar una cita a una fecha u hora pasada.'
        : 'No puedes agendar una cita en una fecha u hora pasada.';
    if (/disponibilidad/i.test(message)) return 'Ese horario no está dentro de la disponibilidad del psicólogo. Selecciona otro.';
    if (message) return message;
  }
  const fallback = {
    slots: 'No fue posible consultar los horarios disponibles. Intenta de nuevo.',
    book: 'No fue posible agendar la cita. Intenta de nuevo.',
    reschedule: 'No fue posible reagendar la cita. Intenta de nuevo.',
    cancel: 'No fue posible cancelar la cita. Intenta de nuevo.',
    close: 'No fue posible actualizar la cita. Intenta de nuevo.',
  } as const;
  return fallback[action];
}

// Appointment.psychologistId is a FK to User. GET /staff/psychologists returns StaffProfile
// rows: { id: StaffProfile.id, user: { id: User.id } }. Always book with user.id.
export function bookingPsychologistId(option: { id: string; user: { id: string } }): string {
  return option.user.id;
}

export const WEEK_DAY_LABEL: Record<string, string> = {
  MONDAY: 'lunes', TUESDAY: 'martes', WEDNESDAY: 'miércoles', THURSDAY: 'jueves',
  FRIDAY: 'viernes', SATURDAY: 'sábado', SUNDAY: 'domingo',
};
