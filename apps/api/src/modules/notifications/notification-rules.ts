import {
  AppointmentStatus,
  NotificationType,
  UserRole,
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

  if (notification.type === NotificationType.STAFF_NEW_BOOKING)
    return { send: false, reason: 'NOT_FOR_AUDIENCE' };
  if (
    notification.type === NotificationType.APPOINTMENT_REMINDER &&
    audience !== 'PATIENT'
  )
    // Reminders are a patient opt-in; psychologists use their agenda.
    return { send: false, reason: 'NOT_FOR_AUDIENCE' };
  const stale = appointmentStateProblem(
    notification,
    appointment,
    now,
    maxDelayMs,
  );
  if (stale) return { send: false, reason: stale };
  if (
    notification.type === NotificationType.APPOINTMENT_REMINDER &&
    !appointment.patient.emailRemindersEnabled
  )
    return { send: false, reason: 'NO_CONSENT' };
  return {
    send: true,
    email: recipient.email,
    endMinute: appointment.endMinute,
    audience,
  };
}

interface AppointmentState {
  status: AppointmentStatus;
  appointmentDate: string;
  startMinute: number;
}

// Is the message still true for the live appointment? null = yes; otherwise the reason.
// Shared by email and push: the same message is never true on one channel and false
// on the other.
function appointmentStateProblem(
  notification: Pick<
    QueuedNotification,
    'type' | 'appointmentDate' | 'startMinute' | 'createdAt'
  >,
  appointment: AppointmentState,
  now: Date,
  maxDelayMs: number,
): string | null {
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
        return 'STALE';
      if (startsAt.getTime() <= now.getTime()) return 'TOO_LATE';
      return null;
    case NotificationType.APPOINTMENT_CONFIRMATION:
    case NotificationType.APPOINTMENT_RESCHEDULE:
    case NotificationType.STAFF_NEW_BOOKING:
      if (appointment.status !== AppointmentStatus.SCHEDULED || !sameSlot)
        return 'STALE';
      if (startsAt.getTime() <= now.getTime()) return 'TOO_LATE';
      if (tooOld) return 'EXPIRED';
      return null;
    case NotificationType.APPOINTMENT_CANCELLATION:
      if (appointment.status !== AppointmentStatus.CANCELLED || !sameSlot)
        return 'STALE';
      if (tooOld) return 'EXPIRED';
      return null;
    default:
      return 'UNKNOWN_TYPE';
  }
}

export type PushAudience = NotificationAudience | 'STAFF';

export interface QueuedPushNotification {
  type: NotificationType;
  recipientUserId: string;
  appointmentDate: string;
  startMinute: number;
  createdAt: Date;
  recipient: { role: UserRole; isActive: boolean };
  appointment: {
    status: AppointmentStatus;
    appointmentDate: string;
    startMinute: number;
    endMinute: number;
    patient: { userId: string };
    psychologistId: string;
  } | null;
}

export type PushDecision =
  | { send: true; audience: PushAudience; endMinute: number }
  | { send: false; reason: string };

// Push: same truth rules as email. The audience is re-derived from the database:
// the patient or psychologist of THIS appointment, or an active STAFF account for
// the new-booking alert. Reminders need no email opt-in: granting the browser
// permission and subscribing is the opt-in for push.
export function decidePushDelivery(
  notification: QueuedPushNotification,
  now: Date,
  maxDelayMs: number,
): PushDecision {
  const appointment = notification.appointment;
  if (!appointment) return { send: false, reason: 'APPOINTMENT_MISSING' };
  if (!notification.recipient.isActive)
    return { send: false, reason: 'RECIPIENT_INACTIVE' };

  let audience: PushAudience;
  if (notification.type === NotificationType.STAFF_NEW_BOOKING) {
    if (notification.recipient.role !== UserRole.STAFF)
      return { send: false, reason: 'RECIPIENT_MISMATCH' };
    audience = 'STAFF';
  } else if (notification.recipientUserId === appointment.patient.userId) {
    audience = 'PATIENT';
  } else if (notification.recipientUserId === appointment.psychologistId) {
    audience = 'PSYCHOLOGIST';
  } else {
    return { send: false, reason: 'RECIPIENT_MISMATCH' };
  }
  if (
    notification.type === NotificationType.APPOINTMENT_REMINDER &&
    audience !== 'PATIENT'
  )
    return { send: false, reason: 'NOT_FOR_AUDIENCE' };

  const stale = appointmentStateProblem(
    notification,
    appointment,
    now,
    maxDelayMs,
  );
  if (stale) return { send: false, reason: stale };
  return { send: true, audience, endMinute: appointment.endMinute };
}

// Retry delays after a transient failure: 5 min, 30 min, 2 h, then 6 h.
export function retryDelayMs(attempt: number): number {
  const minutes = [5, 30, 120, 360];
  return (
    minutes[Math.min(Math.max(attempt, 1), minutes.length) - 1] * 60 * 1000
  );
}
