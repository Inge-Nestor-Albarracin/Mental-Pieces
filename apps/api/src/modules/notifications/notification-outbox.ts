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

export interface AppointmentSlot {
  appointmentId: string;
  // Always the User behind Patient.userId: never an address supplied by a client.
  recipientUserId: string;
  appointmentDate: string;
  startMinute: number;
}

type Tx = Prisma.TransactionClient;

const reminderKey = (slot: AppointmentSlot) =>
  `reminder:${slot.appointmentId}:${slot.appointmentDate}:${slot.startMinute}`;

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

async function scheduleReminder(tx: Tx, slot: AppointmentSlot, now: Date) {
  const at = reminderInstant(slot.appointmentDate, slot.startMinute, now);
  if (!at) return; // Less than 24 h left: confirmation only (documented policy).
  const data = {
    type: NotificationType.APPOINTMENT_REMINDER,
    recipientUserId: slot.recipientUserId,
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
  await tx.notification.create({
    data: {
      type: NotificationType.APPOINTMENT_CONFIRMATION,
      recipientUserId: slot.recipientUserId,
      appointmentId: slot.appointmentId,
      appointmentDate: slot.appointmentDate,
      startMinute: slot.startMinute,
      scheduledFor: now,
      idempotencyKey: `confirmation:${slot.appointmentId}`,
    },
    select: { id: true },
  });
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
    },
  });
  await tx.notification.create({
    data: {
      type: NotificationType.APPOINTMENT_RESCHEDULE,
      recipientUserId: slot.recipientUserId,
      appointmentId: slot.appointmentId,
      appointmentDate: slot.appointmentDate,
      startMinute: slot.startMinute,
      scheduledFor: now,
      idempotencyKey: `reschedule:${slot.appointmentId}:${previous + 1}`,
    },
    select: { id: true },
  });
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
  await tx.notification.create({
    data: {
      type: NotificationType.APPOINTMENT_CANCELLATION,
      recipientUserId: slot.recipientUserId,
      appointmentId: slot.appointmentId,
      appointmentDate: slot.appointmentDate,
      startMinute: slot.startMinute,
      scheduledFor: now,
      idempotencyKey: `cancellation:${slot.appointmentId}`,
    },
    select: { id: true },
  });
}

// COMPLETED / NO_SHOW: no reminder (or late confirmation) may go out afterwards.
export async function closeAppointmentNotifications(
  tx: Tx,
  appointmentId: string,
): Promise<void> {
  await cancelPendingNotifications(tx, appointmentId, 'APPOINTMENT_CLOSED');
}
