import { WeekDay } from '../../../generated/prisma/enums';

const BUSINESS_TIMEZONE = 'America/Bogota';

export interface BusinessNow {
  date: string;
  minute: number;
}

// Single source of business time. Converts the server instant once; never parses
// a localized string back into Date (that applies the offset twice on UTC hosts).
export function businessNow(now = new Date()): BusinessNow {
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
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

// A real calendar date in YYYY-MM-DD (rejects 2026-02-30, which Date would roll over).
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

const WEEK_DAYS: WeekDay[] = [
  WeekDay.SUNDAY,
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
];

// Weekday of a calendar date, independent of the server's local timezone.
export function weekDayOf(date: string): WeekDay {
  return WEEK_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

// Bookable/modifiable only if the session has not started yet (Bogotá time).
export function hasAppointmentStarted(
  date: string,
  startMinute: number,
  now = new Date(),
): boolean {
  const current = businessNow(now);
  return (
    date < current.date ||
    (date === current.date && startMinute <= current.minute)
  );
}

export function hasAppointmentEnded(
  date: string,
  endMinute: number,
  now = new Date(),
): boolean {
  if (
    !isCalendarDate(date) ||
    !Number.isInteger(endMinute) ||
    endMinute < 0 ||
    endMinute > 1440
  )
    return false;
  const current = businessNow(now);
  return (
    date < current.date ||
    (date === current.date && endMinute <= current.minute)
  );
}

export function formatAppointmentTime(minutes: number): string {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}
