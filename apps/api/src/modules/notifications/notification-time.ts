// Business time for notifications. America/Bogota is UTC-5 all year (no daylight
// saving), so a Bogotá wall-clock time converts to UTC by adding 5 hours.
export const BUSINESS_TIMEZONE = 'America/Bogota';
const BOGOTA_OFFSET_MINUTES = 5 * 60;
const HOUR_MS = 60 * 60 * 1000;

export const REMINDER_LEAD_MS = 24 * HOUR_MS;

// Instant (UTC) when an appointment starts: date YYYY-MM-DD + minutes after midnight in Bogotá.
export function appointmentStartUtc(date: string, startMinute: number): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day) +
      (startMinute + BOGOTA_OFFSET_MINUTES) * 60 * 1000,
  );
}

// Reminder 24 h before the start. Returns null when that moment has already passed:
// appointments booked with less than 24 h left get their confirmation only.
export function reminderInstant(
  date: string,
  startMinute: number,
  now = new Date(),
): Date | null {
  const at = new Date(
    appointmentStartUtc(date, startMinute).getTime() - REMINDER_LEAD_MS,
  );
  return at.getTime() > now.getTime() ? at : null;
}

// "lunes, 26 de octubre de 2026" for a calendar date, independent of the host timezone.
export function formatLongDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

// "9:00 a. m." for minutes after midnight.
export function formatClock(minutes: number): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, 0, minutes)));
}
