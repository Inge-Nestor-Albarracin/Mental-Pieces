import { AppointmentStatus } from '../../../generated/prisma/enums';
import { hasAppointmentEnded } from '../appointments/appointment-time';

const BUSINESS_TIMEZONE = 'America/Bogota';

// Operational thresholds (calendar days in America/Bogota). Not a clinical judgement.
export const CARE_ALERT_RULES = {
  noFirstSessionDays: 14,
  inactiveDays: 30,
  highSeverityDays: 60,
  noShowStreak: 2,
} as const;

export type CareAlertReason =
  | 'NO_SHOW_STREAK'
  | 'INACTIVE'
  | 'NO_FIRST_SESSION'
  | 'NO_SHOW_WITHOUT_FOLLOW_UP';

export type CareAlertLevel = 'HIGH' | 'MEDIUM';

export interface CareAlertAppointment {
  appointmentDate: string;
  startMinute: number;
  endMinute: number;
  status: AppointmentStatus;
}

export interface CareAlertEvaluation {
  level: CareAlertLevel;
  reasons: CareAlertReason[];
  lastSessionDate: string | null;
  daysSinceLastSession: number | null;
  daysSinceAssigned: number;
  noShowsSinceLastSession: number;
  nextAppointmentDate: string | null;
}

export function businessDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

function chronological(a: CareAlertAppointment, b: CareAlertAppointment) {
  return (
    a.appointmentDate.localeCompare(b.appointmentDate) ||
    a.startMinute - b.startMinute
  );
}

// Appointments must belong to one active patient–psychologist relationship.
export function evaluateCareAlert(
  assignedAt: Date,
  appointments: CareAlertAppointment[],
  now = new Date(),
): CareAlertEvaluation | null {
  const today = businessDate(now);
  const sorted = [...appointments].sort(chronological);
  const lastSession = sorted
    .filter((item) => item.status === AppointmentStatus.COMPLETED)
    .at(-1);
  const noShowsSinceLastSession = sorted.filter(
    (item) =>
      item.status === AppointmentStatus.NO_SHOW &&
      (!lastSession || chronological(item, lastSession) > 0),
  ).length;
  const next = sorted.find(
    (item) =>
      item.status === AppointmentStatus.SCHEDULED &&
      !hasAppointmentEnded(item.appointmentDate, item.endMinute, now),
  );
  const daysSinceAssigned = Math.max(
    0,
    daysBetween(businessDate(assignedAt), today),
  );
  const daysSinceLastSession = lastSession
    ? Math.max(0, daysBetween(lastSession.appointmentDate, today))
    : null;

  const reasons: CareAlertReason[] = [];
  let high = false;
  if (noShowsSinceLastSession >= CARE_ALERT_RULES.noShowStreak) {
    reasons.push('NO_SHOW_STREAK');
    high = true;
  }
  if (!next) {
    if (
      daysSinceLastSession !== null &&
      daysSinceLastSession >= CARE_ALERT_RULES.inactiveDays
    ) {
      reasons.push('INACTIVE');
      high ||= daysSinceLastSession >= CARE_ALERT_RULES.highSeverityDays;
    }
    if (
      daysSinceLastSession === null &&
      daysSinceAssigned >= CARE_ALERT_RULES.noFirstSessionDays
    ) {
      reasons.push('NO_FIRST_SESSION');
      high ||= daysSinceAssigned >= CARE_ALERT_RULES.highSeverityDays;
    }
    if (noShowsSinceLastSession === 1) {
      reasons.push('NO_SHOW_WITHOUT_FOLLOW_UP');
    }
  }
  if (reasons.length === 0) return null;
  return {
    level: high ? 'HIGH' : 'MEDIUM',
    reasons,
    lastSessionDate: lastSession?.appointmentDate ?? null,
    daysSinceLastSession,
    daysSinceAssigned,
    noShowsSinceLastSession,
    nextAppointmentDate: next?.appointmentDate ?? null,
  };
}
