const BUSINESS_TIMEZONE = 'America/Bogota';

export function hasAppointmentEnded(
  date: string,
  endMinute: number,
  now = new Date(),
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isInteger(endMinute) ||
    endMinute < 0 ||
    endMinute > 1440
  )
    return false;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  )
    return false;
  // Convert the server instant once. Do not parse a localized date back into Date.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const currentMinute = Number(part('hour')) * 60 + Number(part('minute'));
  return date < today || (date === today && endMinute <= currentMinute);
}

export function formatAppointmentTime(minutes: number): string {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}
