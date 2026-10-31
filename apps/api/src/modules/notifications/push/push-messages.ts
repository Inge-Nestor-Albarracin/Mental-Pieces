import { NotificationType } from '../../../../generated/prisma/enums';
import { formatClock, formatLongDate } from '../notification-time';
import type { PushAudience } from '../notification-rules';
import type { PushMessage } from './push-sender';

// Same privacy rule as the emails: a push can be read on a locked screen, so it carries
// only a general text, the date and the time. No names (patient or psychologist),
// reasons or clinical content; the details are inside the app, behind login.

export interface PushMessageInput {
  type: NotificationType;
  audience: PushAudience;
  appointmentId: string;
  appointmentDate: string;
  startMinute: number;
}

const HOME: Record<PushAudience, string> = {
  PATIENT: '/appointments',
  PSYCHOLOGIST: '/psychologist/appointments',
  STAFF: '/staff/dashboard',
};

function titleFor(type: NotificationType, audience: PushAudience): string {
  switch (type) {
    case NotificationType.APPOINTMENT_CONFIRMATION:
      return audience === 'PSYCHOLOGIST'
        ? 'Nueva cita en tu agenda'
        : 'Tu cita quedó agendada';
    case NotificationType.APPOINTMENT_RESCHEDULE:
      return 'Cita reprogramada';
    case NotificationType.APPOINTMENT_CANCELLATION:
      return 'Cita cancelada';
    case NotificationType.APPOINTMENT_REMINDER:
      return 'Recordatorio de tu cita';
    case NotificationType.STAFF_NEW_BOOKING:
      return 'Nueva cita agendada';
    default:
      return 'Mental Pieces';
  }
}

function bodyFor(type: NotificationType, when: string): string {
  switch (type) {
    case NotificationType.APPOINTMENT_RESCHEDULE:
      return `Nueva fecha: ${when}.`;
    case NotificationType.APPOINTMENT_CANCELLATION:
      return `Se canceló la cita del ${when}.`;
    case NotificationType.APPOINTMENT_REMINDER:
      return `Tienes una cita el ${when}.`;
    default:
      return `${when}.`;
  }
}

export function renderPushMessage(input: PushMessageInput): PushMessage {
  const when = `${formatLongDate(input.appointmentDate)}, ${formatClock(input.startMinute)}`;
  return {
    title: titleFor(input.type, input.audience),
    body: bodyFor(input.type, when),
    url: HOME[input.audience],
    tag: `appointment-${input.appointmentId}`,
  };
}

export function renderTestPushMessage(): PushMessage {
  return {
    title: 'Notificaciones activadas',
    body: 'Así verás los avisos de Mental Pieces en este dispositivo.',
    url: '/',
    tag: 'test',
  };
}
