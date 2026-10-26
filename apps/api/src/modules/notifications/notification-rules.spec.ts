import {
  AppointmentStatus,
  NotificationType,
} from '../../../generated/prisma/enums';
import {
  decideDelivery,
  retryDelayMs,
  type QueuedNotification,
} from './notification-rules';

const now = new Date('2026-10-25T14:00:00Z'); // 09:00 in Bogotá
const DAY = 24 * 60 * 60 * 1000;

function queued(
  type: NotificationType,
  patch: Partial<NonNullable<QueuedNotification['appointment']>> = {},
  consent = true,
): QueuedNotification {
  return {
    type,
    recipientUserId: 'user-a',
    appointmentDate: '2026-10-26',
    startMinute: 9 * 60,
    createdAt: new Date(now.getTime() - 60_000),
    appointment: {
      status: AppointmentStatus.SCHEDULED,
      appointmentDate: '2026-10-26',
      startMinute: 9 * 60,
      endMinute: 10 * 60,
      patient: {
        userId: 'user-a',
        emailRemindersEnabled: consent,
        user: { email: 'paciente@example.test', isActive: true },
      },
      psychologist: {
        id: 'psy-1',
        email: 'psicologo@example.test',
        isActive: true,
      },
      ...patch,
    },
  };
}

describe('decideDelivery: the live appointment decides, not the original event', () => {
  it('sends a confirmation to the owner of the appointment', () => {
    expect(
      decideDelivery(
        queued(NotificationType.APPOINTMENT_CONFIRMATION),
        now,
        DAY,
      ),
    ).toEqual({
      send: true,
      email: 'paciente@example.test',
      endMinute: 600,
      audience: 'PATIENT',
    });
  });

  it.each([
    NotificationType.APPOINTMENT_CONFIRMATION,
    NotificationType.APPOINTMENT_RESCHEDULE,
  ])('sends the %s copy to the psychologist of the appointment', (type) => {
    expect(
      decideDelivery({ ...queued(type), recipientUserId: 'psy-1' }, now, DAY),
    ).toEqual({
      send: true,
      email: 'psicologo@example.test',
      endMinute: 600,
      audience: 'PSYCHOLOGIST',
    });
  });

  it('psychologist: cancellation yes, reminders no, inactive no', () => {
    const cancelled = {
      ...queued(NotificationType.APPOINTMENT_CANCELLATION, {
        status: AppointmentStatus.CANCELLED,
      }),
      recipientUserId: 'psy-1',
    };
    expect(decideDelivery(cancelled, now, DAY)).toMatchObject({
      send: true,
      audience: 'PSYCHOLOGIST',
    });
    expect(
      decideDelivery(
        {
          ...queued(NotificationType.APPOINTMENT_REMINDER),
          recipientUserId: 'psy-1',
        },
        now,
        DAY,
      ),
    ).toEqual({ send: false, reason: 'NOT_FOR_AUDIENCE' });
    const inactive = queued(NotificationType.APPOINTMENT_CONFIRMATION, {
      psychologist: {
        id: 'psy-1',
        email: 'psicologo@example.test',
        isActive: false,
      },
    });
    expect(
      decideDelivery({ ...inactive, recipientUserId: 'psy-1' }, now, DAY),
    ).toEqual({ send: false, reason: 'RECIPIENT_INACTIVE' });
  });

  it.each([
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
  ])('never sends a reminder for a %s appointment', (status) => {
    expect(
      decideDelivery(
        queued(NotificationType.APPOINTMENT_REMINDER, { status }),
        now,
        DAY,
      ),
    ).toEqual({ send: false, reason: 'STALE' });
  });

  it('never sends the old date after a reschedule', () => {
    const moved = queued(NotificationType.APPOINTMENT_REMINDER, {
      startMinute: 15 * 60,
    });
    expect(decideDelivery(moved, now, DAY)).toEqual({
      send: false,
      reason: 'STALE',
    });
  });

  it('a reminder requires the patient’s explicit opt-in', () => {
    expect(
      decideDelivery(
        queued(NotificationType.APPOINTMENT_REMINDER, {}, false),
        now,
        DAY,
      ),
    ).toEqual({ send: false, reason: 'NO_CONSENT' });
    expect(
      decideDelivery(
        queued(NotificationType.APPOINTMENT_REMINDER, {}, true),
        now,
        DAY,
      ).send,
    ).toBe(true);
  });

  it('does not send reminders or confirmations once the appointment started', () => {
    const started = { appointmentDate: '2026-10-25', startMinute: 8 * 60 };
    const reminder = {
      ...queued(NotificationType.APPOINTMENT_REMINDER, started),
      ...started,
    };
    expect(decideDelivery(reminder, now, DAY)).toEqual({
      send: false,
      reason: 'TOO_LATE',
    });
  });

  it('a cancellation is sent only if the appointment is really cancelled', () => {
    expect(
      decideDelivery(
        queued(NotificationType.APPOINTMENT_CANCELLATION, {
          status: AppointmentStatus.CANCELLED,
        }),
        now,
        DAY,
      ).send,
    ).toBe(true);
    expect(
      decideDelivery(
        queued(NotificationType.APPOINTMENT_CANCELLATION),
        now,
        DAY,
      ),
    ).toEqual({ send: false, reason: 'STALE' });
  });

  it('drops operational messages that waited longer than the maximum delay', () => {
    const old = {
      ...queued(NotificationType.APPOINTMENT_CONFIRMATION),
      createdAt: new Date(now.getTime() - 2 * DAY),
    };
    expect(decideDelivery(old, now, DAY)).toEqual({
      send: false,
      reason: 'EXPIRED',
    });
  });

  it('refuses a recipient who is not the appointment owner or is inactive', () => {
    expect(
      decideDelivery(
        {
          ...queued(NotificationType.APPOINTMENT_CONFIRMATION),
          recipientUserId: 'user-b',
        },
        now,
        DAY,
      ),
    ).toEqual({ send: false, reason: 'RECIPIENT_MISMATCH' });
    const inactive = queued(NotificationType.APPOINTMENT_CONFIRMATION);
    inactive.appointment!.patient.user.isActive = false;
    expect(decideDelivery(inactive, now, DAY)).toEqual({
      send: false,
      reason: 'RECIPIENT_INACTIVE',
    });
    expect(
      decideDelivery({ ...inactive, appointment: null }, now, DAY),
    ).toEqual({ send: false, reason: 'APPOINTMENT_MISSING' });
  });

  it('backs off between retries and caps the delay', () => {
    expect(
      [1, 2, 3, 4, 9].map((attempt) => retryDelayMs(attempt) / 60_000),
    ).toEqual([5, 30, 120, 360, 360]);
  });
});
