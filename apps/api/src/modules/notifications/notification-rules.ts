import {
  AppointmentStatus,
  NotificationType,
} from '../../../generated/prisma/enums';
import { appointmentStartUtc } from './notification-time';

// Decides, right before sending, whether a queued message is still true. The event that
// queued it is not trusted: the live appointment is the authority.

export type NotificationAudience = 'PATIENT' | 'PSYCHOLOGIST';

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
    psychologist: { id: string; email: string; isActive: boolean };
  } | null;
}

export type SendDecision =
  | {
      send: true;
      email: string;
      endMinute: number;
      audience: NotificationAudience;
    }
  | { send: false; reason: string };

export function decideDelivery(
  notification: QueuedNotification,
  now: Date,
  maxDelayMs: number,
): SendDecision {
  const appointment = notification.appointment;
  if (!appointment) return { send: false, reason: 'APPOINTMENT_MISSING' };

  // The recipient must still be the patient or the psychologist of THIS appointment,
  // re-derived from the database (never from the request that queued the message).
  let audience: NotificationAudience;
  let recipient: { email: string; isActive: boolean };
  if (notification.recipientUserId === appointment.patient.userId) {
    audience = 'PATIENT';
    recipient = appointment.patient.user;
  } else if (notification.recipientUserId === appointment.psychologist.id) {
    audience = 'PSYCHOLOGIST';
    recipient = appointment.psychologist;
  } else {
    return { send: false, reason: 'RECIPIENT_MISMATCH' };
  }
  if (!recipient.isActive || !recipient.email)
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
      // Reminders are a patient opt-in; psychologists use their agenda.
      if (audience !== 'PATIENT')
        return { send: false, reason: 'NOT_FOR_AUDIENCE' };
      if (appointment.status !== AppointmentStatus.SCHEDULED || !sameSlot)
        return { send: false, reason: 'STALE' };
      if (startsAt.getTime() <= now.getTime())
        return { send: false, reason: 'TOO_LATE' };
      if (!appointment.patient.emailRemindersEnabled)
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
    email: recipient.email,
    endMinute: appointment.endMinute,
    audience,
  };
}

// Retry delays after a transient failure: 5 min, 30 min, 2 h, then 6 h.
export function retryDelayMs(attempt: number): number {
  const minutes = [5, 30, 120, 360];
  return (
    minutes[Math.min(Math.max(attempt, 1), minutes.length) - 1] * 60 * 1000
  );
}
