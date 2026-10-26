import type { Prisma } from '../../../generated/prisma/client';
import {
  NotificationStatus,
  NotificationType,
} from '../../../generated/prisma/enums';
import { reminderInstant } from './notification-time';

// Transactional outbox. These functions ONLY write Notification rows and must be called
// inside the same transaction that changes the appointment: if that transaction rolls
// back (conflict, serialization retry), no notification exists. Nothing is sent here;
// the cron processor sends later, outside any appointment transaction.
//
// Booking, rescheduling and cancelling notify BOTH the patient and the psychologist.
// The audience is not stored: the processor derives it by comparing recipientUserId
// with the appointment's patient and psychologist (no extra column, no migration).

export interface AppointmentSlot {
  appointmentId: string;
  // Users behind Patient.userId and Appointment.psychologistId; never client-supplied.
  patientUserId: string;
  psychologistUserId: string;
  appointmentDate: string;
  startMinute: number;
}

type Tx = Prisma.TransactionClient;
type Audience = 'patient' | 'psychologist';

const reminderKey = (slot: AppointmentSlot) =>
  `reminder:${slot.appointmentId}:${slot.appointmentDate}:${slot.startMinute}`;

// Patient keys keep their original format; psychologist keys add a prefix.
const keyFor = (audience: Audience, base: string) =>
  audience === 'patient' ? base : `psychologist:${base}`;

const recipientOf = (slot: AppointmentSlot, audience: Audience) =>
  audience === 'patient' ? slot.patientUserId : slot.psychologistUserId;

// Marks every still-pending message of an appointment as no longer valid.
export async function cancelPendingNotifications(
  tx: Tx,
  appointmentId: string,
  reason: string,
  types?: NotificationType[],
): Promise<number> {
  const result = await tx.notification.updateMany({
    where: {
      appointmentId,
      status: NotificationStatus.PENDING,
      ...(types ? { type: { in: types } } : {}),
    },
    data: { status: NotificationStatus.CANCELLED, errorCode: reason },
  });
  return result.count;
}

async function queueForBoth(
  tx: Tx,
  slot: AppointmentSlot,
  type: NotificationType,
  baseKey: string,
  now: Date,
) {
  for (const audience of ['patient', 'psychologist'] as const) {
    await tx.notification.create({
      data: {
        type,
        recipientUserId: recipientOf(slot, audience),
        appointmentId: slot.appointmentId,
        appointmentDate: slot.appointmentDate,
        startMinute: slot.startMinute,
        scheduledFor: now,
        idempotencyKey: keyFor(audience, baseKey),
      },
      select: { id: true },
    });
  }
}

// 24 h reminder: patient only, and only sent if the patient opted in.
async function scheduleReminder(tx: Tx, slot: AppointmentSlot, now: Date) {
  const at = reminderInstant(slot.appointmentDate, slot.startMinute, now);
  if (!at) return; // Less than 24 h left: confirmation only (documented policy).
  const data = {
    type: NotificationType.APPOINTMENT_REMINDER,
    recipientUserId: slot.patientUserId,
    appointmentId: slot.appointmentId,
    appointmentDate: slot.appointmentDate,
    startMinute: slot.startMinute,
    scheduledFor: at,
  };
  // Moving back to a slot used before re-arms its cancelled reminder instead of
  // violating the unique key; an already sent reminder is never sent again.
  const existing = await tx.notification.findUnique({
    where: { idempotencyKey: reminderKey(slot) },
    select: { id: true, status: true },
  });
  if (!existing) {
    await tx.notification.create({
      data: { ...data, idempotencyKey: reminderKey(slot) },
      select: { id: true },
    });
  } else if (existing.status === NotificationStatus.CANCELLED) {
    await tx.notification.update({
      where: { id: existing.id },
      data: {
        status: NotificationStatus.PENDING,
        scheduledFor: at,
        attempts: 0,
        errorCode: null,
        lockedUntil: null,
      },
      select: { id: true },
    });
  }
}

export async function enqueueAppointmentBooked(
  tx: Tx,
  slot: AppointmentSlot,
  now = new Date(),
): Promise<void> {
  await queueForBoth(
    tx,
    slot,
    NotificationType.APPOINTMENT_CONFIRMATION,
    `confirmation:${slot.appointmentId}`,
    now,
  );
  await scheduleReminder(tx, slot, now);
}

export async function enqueueAppointmentRescheduled(
  tx: Tx,
  slot: AppointmentSlot,
  now = new Date(),
): Promise<void> {
  // Anything still pending talks about the old slot (or is superseded): drop it.
  await cancelPendingNotifications(tx, slot.appointmentId, 'SUPERSEDED');
  // Deterministic per transaction attempt: a serialization retry recomputes the same key.
  const previous = await tx.notification.count({
    where: {
      appointmentId: slot.appointmentId,
      type: NotificationType.APPOINTMENT_RESCHEDULE,
      recipientUserId: slot.patientUserId,
    },
  });
  await queueForBoth(
    tx,
    slot,
    NotificationType.APPOINTMENT_RESCHEDULE,
    `reschedule:${slot.appointmentId}:${previous + 1}`,
    now,
  );
  await scheduleReminder(tx, slot, now);
}

export async function enqueueAppointmentCancelled(
  tx: Tx,
  slot: AppointmentSlot,
  now = new Date(),
): Promise<void> {
  await cancelPendingNotifications(
    tx,
    slot.appointmentId,
    'APPOINTMENT_CANCELLED',
  );
  await queueForBoth(
    tx,
    slot,
    NotificationType.APPOINTMENT_CANCELLATION,
    `cancellation:${slot.appointmentId}`,
    now,
  );
}

// COMPLETED / NO_SHOW: no reminder (or late confirmation) may go out afterwards.
export async function closeAppointmentNotifications(
  tx: Tx,
  appointmentId: string,
): Promise<void> {
  await cancelPendingNotifications(tx, appointmentId, 'APPOINTMENT_CLOSED');
}
