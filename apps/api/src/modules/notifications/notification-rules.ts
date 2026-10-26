import {
  AppointmentStatus,
  NotificationType,
} from '../../../generated/prisma/enums';
import { appointmentStartUtc } from './notification-time';

// Decides, right before sending, whether a queued message is still true. The event that
// queued it is not trusted: the live appointment is the authority.

export interface QueuedNotification {
  type: NotificationType;
  recipientUserId: string;
  appointmentDate: string;
  startMinute: number;
  createdAt: Date;
  appointment: {
    status: AppointmentStatus;
    appointmentDate: string;
    startMinute: number;
    endMinute: number;
    patient: {
      userId: string;
      emailRemindersEnabled: boolean;
      user: { email: string; isActive: boolean };
    };
  } | null;
}

export type SendDecision =
  | { send: true; email: string; endMinute: number }
  | { send: false; reason: string };

export function decideDelivery(
  notification: QueuedNotification,
  now: Date,
  maxDelayMs: number,
): SendDecision {
  const appointment = notification.appointment;
  if (!appointment) return { send: false, reason: 'APPOINTMENT_MISSING' };
  const patient = appointment.patient;
  // The recipient is always the owner of the appointment, re-derived from the database.
  if (patient.userId !== notification.recipientUserId)
    return { send: false, reason: 'RECIPIENT_MISMATCH' };
  if (!patient.user.isActive || !patient.user.email)
    return { send: false, reason: 'RECIPIENT_INACTIVE' };

  const sameSlot =
    appointment.appointmentDate === notification.appointmentDate &&
    appointment.startMinute === notification.startMinute;
  const startsAt = appointmentStartUtc(
    appointment.appointmentDate,
    appointment.startMinute,
  );
  const tooOld = now.getTime() - notification.createdAt.getTime() > maxDelayMs;

  switch (notification.type) {
    case NotificationType.APPOINTMENT_REMINDER:
      if (appointment.status !== AppointmentStatus.SCHEDULED || !sameSlot)
        return { send: false, reason: 'STALE' };
      if (startsAt.getTime() <= now.getTime())
        return { send: false, reason: 'TOO_LATE' };
      if (!patient.emailRemindersEnabled)
        return { send: false, reason: 'NO_CONSENT' };
      break;
    case NotificationType.APPOINTMENT_CONFIRMATION:
    case NotificationType.APPOINTMENT_RESCHEDULE:
      if (appointment.status !== AppointmentStatus.SCHEDULED || !sameSlot)
        return { send: false, reason: 'STALE' };
      if (startsAt.getTime() <= now.getTime())
        return { send: false, reason: 'TOO_LATE' };
      if (tooOld) return { send: false, reason: 'EXPIRED' };
      break;
    case NotificationType.APPOINTMENT_CANCELLATION:
      if (appointment.status !== AppointmentStatus.CANCELLED || !sameSlot)
        return { send: false, reason: 'STALE' };
      if (tooOld) return { send: false, reason: 'EXPIRED' };
      break;
    default:
      return { send: false, reason: 'UNKNOWN_TYPE' };
  }
  return {
    send: true,
    email: patient.user.email,
    endMinute: appointment.endMinute,
  };
}

// Retry delays after a transient failure: 5 min, 30 min, 2 h, then 6 h.
export function retryDelayMs(attempt: number): number {
  const minutes = [5, 30, 120, 360];
  return (
    minutes[Math.min(Math.max(attempt, 1), minutes.length) - 1] * 60 * 1000
  );
}
