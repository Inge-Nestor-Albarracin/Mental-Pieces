// Level I: reception booking + Web Push against a disposable PostgreSQL. A fake
// PushSender records messages: nothing is ever sent to a real push service.
import { ConflictException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  UserRole,
} from '../../generated/prisma/enums';
import { PrismaService } from '../../src/database/prisma.service';
import { AppointmentsService } from '../../src/modules/appointments/appointments.service';
import { StaffDeskService } from '../../src/modules/appointments/staff-desk.service';
import type { PushConfig } from '../../src/modules/notifications/push/push-config';
import { PushProcessor } from '../../src/modules/notifications/push/push-processor';
import {
  PushDeliveryError,
  type PushMessage,
  type PushSender,
  type PushTarget,
} from '../../src/modules/notifications/push/push-sender';
import { PushDispatcher } from '../../src/modules/push/push-dispatcher';
import {
  assertDisposableDatabase,
  businessDatePlus,
  Fixtures,
  type FixtureUser,
} from './support/fixtures';

class FakePushSender implements PushSender {
  sent: { target: PushTarget; message: PushMessage }[] = [];
  failFor = new Map<string, PushDeliveryError>();
  send(target: PushTarget, message: PushMessage) {
    const failure = this.failFor.get(target.endpoint);
    if (failure) return Promise.reject(failure);
    this.sent.push({ target, message });
    return Promise.resolve();
  }
}

const HOUR = 60 * 60 * 1000;
const pushConfig: PushConfig = {
  enabled: true,
  publicKey: `B${'A'.repeat(86)}`,
  privateKey: 'a'.repeat(43),
  subject: 'mailto:pruebas@example.invalid',
  ttlSeconds: 3600,
  batchSize: 100,
  maxAttempts: 4,
  maxRuntimeMs: 60_000,
  leaseMs: 10 * 60_000,
  maxDelayMs: 12 * HOUR,
};

let endpointCounter = 0;
const P256DH = `B${'k'.repeat(86)}`;
const AUTH = 'a'.repeat(22);

describe('Reception booking and Web Push (Level I, disposable PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fx = new Fixtures(prisma);
  const appointments = new AppointmentsService(
    prisma,
    new PushDispatcher(prisma),
  );
  const desk = new StaffDeskService(prisma);
  let psychologist: FixtureUser;
  let staff: FixtureUser;
  let otherStaff: FixtureUser;
  let staffWithoutPush: FixtureUser;

  async function subscribe(user: FixtureUser) {
    endpointCounter += 1;
    const endpoint = `https://fcm.googleapis.com/fcm/send/${fx.tag}-${endpointCounter}`;
    await prisma.pushSubscription.create({
      data: { userId: user.userId, endpoint, p256dh: P256DH, auth: AUTH },
    });
    return endpoint;
  }

  const pushRows = (appointmentId: string) =>
    prisma.notification.findMany({
      where: { appointmentId, channel: NotificationChannel.PUSH },
      select: {
        type: true,
        recipientUserId: true,
        status: true,
        errorCode: true,
      },
    });

  beforeAll(async () => {
    await prisma.$connect();
    await assertDisposableDatabase(prisma);
    psychologist = await fx.psychologist();
    staff = await fx.staffUser(UserRole.STAFF);
    otherStaff = await fx.staffUser(UserRole.STAFF);
    staffWithoutPush = await fx.staffUser(UserRole.STAFF);
    await subscribe(staff);
    await subscribe(otherStaff);
  });

  afterAll(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
  });

  it('a patient booking alerts every subscribed staff account (push only) and pushes the subscribed patient', async () => {
    const patient = await fx.patient();
    await subscribe(patient);
    const booked = await appointments.create(patient.userId, {
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(4),
      startTime: '10:00',
    });

    const rows = await pushRows(booked.id);
    const alerts = rows.filter(
      (row) => row.type === NotificationType.STAFF_NEW_BOOKING,
    );
    expect(alerts.map((row) => row.recipientUserId).sort()).toEqual(
      [staff.userId, otherStaff.userId].sort(),
    );
    expect(alerts.map((r) => r.recipientUserId)).not.toContain(
      staffWithoutPush.userId,
    );
    // Patient: push confirmation + push reminder; psychologist has no subscription.
    expect(
      rows
        .filter((row) => row.recipientUserId === patient.userId)
        .map((row) => row.type)
        .sort(),
    ).toEqual(
      [
        NotificationType.APPOINTMENT_CONFIRMATION,
        NotificationType.APPOINTMENT_REMINDER,
      ].sort(),
    );
    expect(rows.some((r) => r.recipientUserId === psychologist.userId)).toBe(
      false,
    );
    // Emails are still queued exactly as before (no STAFF email).
    const emails = await prisma.notification.findMany({
      where: { appointmentId: booked.id, channel: NotificationChannel.EMAIL },
      select: { type: true },
    });
    expect(emails.map((e) => e.type)).not.toContain(
      NotificationType.STAFF_NEW_BOOKING,
    );
  });

  it('staff books for a patient: same rules, recorded as booked by staff, the booker is not alerted', async () => {
    const patient = await fx.patient();
    const booked = await appointments.createForPatient(staff.userId, {
      patientId: patient.patientId!,
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(5),
      startTime: '11:00',
    });
    const row = await prisma.appointment.findUniqueOrThrow({
      where: { id: booked.id },
      select: { bookedByUserId: true, patientId: true },
    });
    expect(row).toEqual({
      bookedByUserId: staff.userId,
      patientId: patient.patientId,
    });
    const alerts = (await pushRows(booked.id)).filter(
      (r) => r.type === NotificationType.STAFF_NEW_BOOKING,
    );
    expect(alerts.map((r) => r.recipientUserId)).toEqual([otherStaff.userId]);
  });

  it('staff cannot double-book the psychologist', async () => {
    const first = await fx.patient();
    const second = await fx.patient();
    const slot = {
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(6),
      startTime: '09:00',
    };
    await appointments.createForPatient(staff.userId, {
      ...slot,
      patientId: first.patientId!,
    });
    await expect(
      appointments.createForPatient(staff.userId, {
        ...slot,
        patientId: second.patientId!,
      }),
    ).rejects.toThrow(
      'El psicólogo ya tiene otra cita programada en ese horario.',
    );
  });

  it('staff gets reception wording for incomplete profiles and missing consent', async () => {
    const incomplete = await fx.patient('Incompleto', { complete: false });
    await expect(
      appointments.createForPatient(staff.userId, {
        patientId: incomplete.patientId!,
        psychologistId: psychologist.userId,
        appointmentDate: businessDatePlus(7),
        startTime: '10:00',
      }),
    ).rejects.toThrow(/El paciente debe completar su perfil/);

    const noConsent = await fx.patient('Sin consentimiento', {
      consent: false,
    });
    const attempt = appointments.createForPatient(staff.userId, {
      patientId: noConsent.patientId!,
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(7),
      startTime: '11:00',
    });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(/aún no ha aceptado la Política/);
  });

  it('only an active STAFF account can book for patients', async () => {
    const patient = await fx.patient();
    const admin = await fx.staffUser(UserRole.ADMIN);
    const inactive = await fx.staffUser(UserRole.STAFF, false);
    for (const actor of [admin, inactive, psychologist]) {
      await expect(
        appointments.createForPatient(actor.userId, {
          patientId: patient.patientId!,
          psychologistId: psychologist.userId,
          appointmentDate: businessDatePlus(8),
          startTime: '10:00',
        }),
      ).rejects.toThrow(
        'Solo el personal activo puede agendar citas para pacientes.',
      );
    }
  });

  it('desk search flags what blocks booking; agenda groups upcoming appointments per psychologist', async () => {
    const ready = await fx.patient(`Buscable ${fx.tag}`);
    await fx.patient(`Buscable ${fx.tag} sin perfil`, { complete: false });
    const found = await desk.searchPatients(staff.userId, `Buscable ${fx.tag}`);
    expect(found.items).toHaveLength(2);
    const byName = (name: string) =>
      found.items.find((item) => item.fullName === name);
    expect(byName(`Buscable ${fx.tag}`)).toMatchObject({
      canBook: true,
      blockers: [],
    });
    expect(byName(`Buscable ${fx.tag} sin perfil`)?.blockers).toEqual([
      'PROFILE_INCOMPLETE',
    ]);

    const booked = await appointments.createForPatient(staff.userId, {
      patientId: ready.patientId!,
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(2),
      startTime: '15:00',
    });
    const agenda = await desk.upcomingByPsychologist(
      staff.userId,
      14,
      psychologist.userId,
    );
    expect(agenda.psychologists).toHaveLength(1);
    const item = agenda.psychologists[0].appointments.find(
      (a) => a.id === booked.id,
    );
    expect(item).toMatchObject({
      startTime: '15:00',
      endTime: '16:00',
      bookedByStaff: true,
      patient: { fullName: `Buscable ${fx.tag}` },
    });
    // Administrative data only.
    expect(Object.keys(item!.patient).sort()).toEqual([
      'fullName',
      'id',
      'mrn',
    ]);
  });

  it('processor pushes to every device, deletes gone subscriptions and drops stale alerts', async () => {
    const patient = await fx.patient();
    const phone = await subscribe(patient);
    const oldLaptop = await subscribe(patient);
    const booked = await appointments.create(patient.userId, {
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(9),
      startTime: '12:00',
    });

    const sender = new FakePushSender();
    sender.failFor.set(
      oldLaptop,
      new PushDeliveryError('PUSH_410', false, true),
    );
    await new PushProcessor(prisma, sender, pushConfig).runOnce();

    const rows = await pushRows(booked.id);
    const confirmation = rows.find(
      (r) =>
        r.recipientUserId === patient.userId &&
        r.type === NotificationType.APPOINTMENT_CONFIRMATION,
    );
    expect(confirmation?.status).toBe(NotificationStatus.ACCEPTED);
    const staffAlerts = rows.filter(
      (r) => r.type === NotificationType.STAFF_NEW_BOOKING,
    );
    expect(
      staffAlerts.every((r) => r.status === NotificationStatus.ACCEPTED),
    ).toBe(true);
    // The reminder waits for its time (24 h before).
    expect(
      rows.find((r) => r.type === NotificationType.APPOINTMENT_REMINDER)
        ?.status,
    ).toBe(NotificationStatus.PENDING);

    const toPatient = sender.sent.filter((s) => s.target.endpoint === phone);
    expect(toPatient.map((s) => s.message.url)).toEqual(['/appointments']);
    expect(
      sender.sent
        .filter((s) => s.message.title === 'Nueva cita agendada')
        .every((s) => s.message.url === '/staff/dashboard'),
    ).toBe(true);
    // No names in any push.
    for (const { message } of sender.sent) {
      expect(`${message.title} ${message.body}`).not.toMatch(/Sintético/);
    }
    expect(
      await prisma.pushSubscription.count({ where: { endpoint: oldLaptop } }),
    ).toBe(0);

    // Cancelled before the alert goes out: the alert is dropped as STALE.
    const late = await fx.patient();
    const second = await appointments.create(late.userId, {
      psychologistId: psychologist.userId,
      appointmentDate: businessDatePlus(10),
      startTime: '12:00',
    });
    await appointments.cancel(late.userId, second.id, {});
    await new PushProcessor(prisma, new FakePushSender(), pushConfig).runOnce();
    const alerts = (await pushRows(second.id)).filter(
      (r) => r.type === NotificationType.STAFF_NEW_BOOKING,
    );
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((r) => r.status === NotificationStatus.CANCELLED)).toBe(
      true,
    );
  });

  it('the email processor never claims push messages', async () => {
    const pending = await prisma.notification.count({
      where: {
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PROCESSING,
      },
    });
    expect(pending).toBe(0);
  });
});
