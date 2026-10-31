import type { Prisma } from '../../../generated/prisma/client';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  UserRole,
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
//
// Push: every email message also gets a PUSH twin (key prefixed "push:"), but only for
// recipients that have at least one push subscription at that moment. Bookings also
// alert every active STAFF account with a subscription (STAFF_NEW_BOOKING, push only).

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

const pushKey = (key: string) => `push:${key}`;

// Users (among `userIds`) that can receive a push right now.
async function pushReachable(tx: Tx, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return new Set(rows.map((row) => row.userId));
}

async function queueForBoth(
  tx: Tx,
  slot: AppointmentSlot,
  type: NotificationType,
  baseKey: string,
  now: Date,
) {
  const reachable = await pushReachable(tx, [
    slot.patientUserId,
    slot.psychologistUserId,
  ]);
  for (const audience of ['patient', 'psychologist'] as const) {
    const recipientUserId = recipientOf(slot, audience);
    const data = {
      type,
      recipientUserId,
      appointmentId: slot.appointmentId,
      appointmentDate: slot.appointmentDate,
      startMinute: slot.startMinute,
      scheduledFor: now,
    };
    await tx.notification.create({
      data: { ...data, idempotencyKey: keyFor(audience, baseKey) },
      select: { id: true },
    });
    if (reachable.has(recipientUserId)) {
      await tx.notification.create({
        data: {
          ...data,
          channel: NotificationChannel.PUSH,
          idempotencyKey: pushKey(keyFor(audience, baseKey)),
        },
        select: { id: true },
      });
    }
  }
}

// New booking: a push alert to every active staff account with a subscription,
// except the staff member who made the booking.
async function queueStaffBookingAlerts(
  tx: Tx,
  slot: AppointmentSlot,
  now: Date,
  bookedByUserId?: string,
) {
  const staff = await tx.user.findMany({
    where: {
      role: UserRole.STAFF,
      isActive: true,
      pushSubscriptions: { some: {} },
      ...(bookedByUserId ? { id: { not: bookedByUserId } } : {}),
    },
    select: { id: true },
  });
  for (const member of staff) {
    await tx.notification.create({
      data: {
        type: NotificationType.STAFF_NEW_BOOKING,
        channel: NotificationChannel.PUSH,
        recipientUserId: member.id,
        appointmentId: slot.appointmentId,
        appointmentDate: slot.appointmentDate,
        startMinute: slot.startMinute,
        scheduledFor: now,
        idempotencyKey: `push:staff-booking:${slot.appointmentId}:${member.id}`,
      },
      select: { id: true },
    });
  }
}

// 24 h reminder: patient only. Email only if the patient opted in (checked when
// sending); push if the patient has a subscription.
async function scheduleReminder(tx: Tx, slot: AppointmentSlot, now: Date) {
  const at = reminderInstant(slot.appointmentDate, slot.startMinute, now);
  if (!at) return; // Less than 24 h left: confirmation only (documented policy).
  await armReminder(tx, slot, at, NotificationChannel.EMAIL, reminderKey(slot));
  if ((await pushReachable(tx, [slot.patientUserId])).size > 0) {
    await armReminder(
      tx,
      slot,
      at,
      NotificationChannel.PUSH,
      pushKey(reminderKey(slot)),
    );
  }
}

async function armReminder(
  tx: Tx,
  slot: AppointmentSlot,
  at: Date,
  channel: NotificationChannel,
  idempotencyKey: string,
) {
  const data = {
    type: NotificationType.APPOINTMENT_REMINDER,
    channel,
    recipientUserId: slot.patientUserId,
    appointmentId: slot.appointmentId,
    appointmentDate: slot.appointmentDate,
    startMinute: slot.startMinute,
    scheduledFor: at,
  };
  // Moving back to a slot used before re-arms its cancelled reminder instead of
  // violating the unique key; an already sent reminder is never sent again.
  const existing = await tx.notification.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (!existing) {
    await tx.notification.create({
      data: { ...data, idempotencyKey },
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
  bookedByUserId?: string,
): Promise<void> {
  await queueForBoth(
    tx,
    slot,
    NotificationType.APPOINTMENT_CONFIRMATION,
    `confirmation:${slot.appointmentId}`,
    now,
  );
  await scheduleReminder(tx, slot, now);
  await queueStaffBookingAlerts(tx, slot, now, bookedByUserId);
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
      channel: NotificationChannel.EMAIL,
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
