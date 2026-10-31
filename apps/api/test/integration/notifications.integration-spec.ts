// Level I: email notifications against a disposable PostgreSQL. A fake EmailSender
// records messages: no real email is ever sent from tests.
import { ConflictException } from '@nestjs/common';
import {
  AppointmentStatus,
  NotificationStatus,
  NotificationType,
} from '../../generated/prisma/enums';
import { PrismaService } from '../../src/database/prisma.service';
import { AppointmentLifecycleService } from '../../src/modules/appointments/appointment-lifecycle.service';
import { AppointmentsService } from '../../src/modules/appointments/appointments.service';
import { PushDispatcher } from '../../src/modules/push/push-dispatcher';
import { businessNow } from '../../src/modules/appointments/appointment-time';
import {
  EmailDeliveryError,
  type EmailSender,
  type OutgoingEmail,
} from '../../src/modules/notifications/email/email-sender';
import { NotificationProcessor } from '../../src/modules/notifications/notification-processor';
import { appointmentStartUtc } from '../../src/modules/notifications/notification-time';
import type { NotificationsConfig } from '../../src/modules/notifications/notifications-config';
import {
  assertDisposableDatabase,
  businessDatePlus,
  Fixtures,
  minutes,
  type FixtureUser,
} from './support/fixtures';

class FakeSender implements EmailSender {
  sent: OutgoingEmail[] = [];
  failures: EmailDeliveryError[] = [];
  delayMs = 0;
  send(email: OutgoingEmail) {
    return new Promise<{ messageId: string | null }>((resolve, reject) => {
      setTimeout(() => {
        const failure = this.failures.shift();
        if (failure) return reject(failure);
        this.sent.push(email);
        resolve({ messageId: `<fake-${this.sent.length}@test>` });
      }, this.delayMs);
    });
  }
  verify() {
    return Promise.resolve();
  }
  close() {}
}

const DAY = 24 * 60 * 60 * 1000;
const config = (
  patch: Partial<NotificationsConfig> = {},
): NotificationsConfig => ({
  enabled: true,
  recipientAllowlist: '*',
  batchSize: 50,
  dailyLimit: 1000,
  perRecipientDailyLimit: 100,
  psychologistDailyLimit: 100,
  maxAttempts: 4,
  maxRuntimeMs: 60_000,
  leaseMs: 10 * 60_000,
  maxDelayMs: DAY,
  appUrl: 'https://mentalpieces.site',
  ...patch,
});

describe('Email notifications: outbox + processor (Level I, disposable PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fx = new Fixtures(prisma);
  // Push is disabled (no PUSH_ENABLED): kick() is a no-op.
  const appointments = new AppointmentsService(
    prisma,
    new PushDispatcher(prisma),
  );
  const lifecycle = new AppointmentLifecycleService(prisma);
  let psychologist: FixtureUser;

  beforeAll(async () => {
    await prisma.$connect();
    await assertDisposableDatabase(prisma);
    psychologist = await fx.psychologist();
  });

  afterAll(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
  });

  const rows = (appointmentId: string) =>
    prisma.notification.findMany({
      where: { appointmentId },
      orderBy: [{ createdAt: 'asc' }, { idempotencyKey: 'asc' }],
    });

  // [who, type, status, errorCode] sorted, so assertions do not depend on insert order.
  async function summary(appointmentId: string, patient: FixtureUser) {
    const who = (userId: string) =>
      userId === patient.userId
        ? 'patient'
        : userId === psychologist.userId
          ? 'psychologist'
          : 'other';
    return (await rows(appointmentId))
      .map((n) => [who(n.recipientUserId), n.type, n.status, n.errorCode])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  async function book(patient: FixtureUser, date: string, time: string) {
    return appointments.create(patient.userId, {
      psychologistId: psychologist.userId,
      appointmentDate: date,
      startTime: time,
    });
  }

  // A future slot less than 24 h ahead (within the 06:00–22:00 test availability).
  function slotWithin24h(): { date: string; time: string } {
    const now = businessNow();
    const nextHour = Math.floor(now.minute / 60) + 2;
    if (nextHour <= 21)
      return {
        date: now.date,
        time: `${String(nextHour).padStart(2, '0')}:00`,
      };
    return { date: businessDatePlus(1), time: '06:00' };
  }

  const {
    APPOINTMENT_CONFIRMATION,
    APPOINTMENT_REMINDER,
    APPOINTMENT_CANCELLATION,
    APPOINTMENT_RESCHEDULE,
  } = NotificationType;
  const { PENDING, CANCELLED, ACCEPTED, FAILED } = NotificationStatus;

  describe('outbox (written in the appointment transaction)', () => {
    it('1-2: booking queues a confirmation for patient AND psychologist, and the patient reminder', async () => {
      const patient = await fx.patient();
      const date = businessDatePlus(5);
      const appointment = await book(patient, date, '09:00');
      expect(await summary(appointment.id, patient)).toEqual([
        ['patient', APPOINTMENT_CONFIRMATION, PENDING, null],
        ['patient', APPOINTMENT_REMINDER, PENDING, null],
        ['psychologist', APPOINTMENT_CONFIRMATION, PENDING, null],
      ]);
      const reminder = (await rows(appointment.id)).find(
        (n) => n.type === APPOINTMENT_REMINDER,
      );
      expect(reminder?.scheduledFor.toISOString()).toBe(
        new Date(
          appointmentStartUtc(date, minutes('09:00')).getTime() - DAY,
        ).toISOString(),
      );
      expect(reminder?.channel).toBe('EMAIL');
    });

    it('16: booked with less than 24 h left: confirmations only, no retroactive reminder', async () => {
      const patient = await fx.patient();
      const slot = slotWithin24h();
      const appointment = await book(patient, slot.date, slot.time);
      expect(await summary(appointment.id, patient)).toEqual([
        ['patient', APPOINTMENT_CONFIRMATION, PENDING, null],
        ['psychologist', APPOINTMENT_CONFIRMATION, PENDING, null],
      ]);
    });

    it('3-4: a rejected booking creates no notification (rolled back with the transaction)', async () => {
      const [a, b] = [await fx.patient(), await fx.patient()];
      const date = businessDatePlus(6);
      await book(a, date, '10:00');
      await expect(book(b, date, '10:00')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(
        await prisma.notification.count({
          where: { recipientUserId: b.userId },
        }),
      ).toBe(0);
    });

    it('race: two simultaneous bookings of one slot leave notifications for the winner only', async () => {
      const [a, b] = [await fx.patient(), await fx.patient()];
      const date = businessDatePlus(7);
      const results = await Promise.allSettled([
        book(a, date, '11:00'),
        book(b, date, '11:00'),
      ]);
      const winner = results.find((r) => r.status === 'fulfilled');
      expect(winner).toBeDefined();
      const id = (winner as PromiseFulfilledResult<{ id: string }>).value.id;
      const patientRows = await prisma.notification.findMany({
        where: { recipientUserId: { in: [a.userId, b.userId] } },
        select: { recipientUserId: true },
      });
      expect(patientRows).toHaveLength(2); // confirmation + reminder of the winner
      expect(new Set(patientRows.map((o) => o.recipientUserId)).size).toBe(1);
      expect(
        await prisma.notification.count({
          where: { appointmentId: id, recipientUserId: psychologist.userId },
        }),
      ).toBe(1);
    });

    it('5: cancelling drops pending messages and notifies patient and psychologist', async () => {
      const patient = await fx.patient();
      const appointment = await book(patient, businessDatePlus(8), '09:00');
      await appointments.cancel(patient.userId, appointment.id, {});
      expect(await summary(appointment.id, patient)).toEqual([
        ['patient', APPOINTMENT_CANCELLATION, PENDING, null],
        [
          'patient',
          APPOINTMENT_CONFIRMATION,
          CANCELLED,
          'APPOINTMENT_CANCELLED',
        ],
        ['patient', APPOINTMENT_REMINDER, CANCELLED, 'APPOINTMENT_CANCELLED'],
        ['psychologist', APPOINTMENT_CANCELLATION, PENDING, null],
        [
          'psychologist',
          APPOINTMENT_CONFIRMATION,
          CANCELLED,
          'APPOINTMENT_CANCELLED',
        ],
      ]);
    });

    it('6-7: rescheduling invalidates old messages and notifies both with the new slot', async () => {
      const patient = await fx.patient();
      const date = businessDatePlus(9);
      const appointment = await book(patient, date, '09:00');
      await appointments.reschedule(patient.userId, appointment.id, {
        appointmentDate: date,
        startTime: '15:00',
      });
      const pending = (await rows(appointment.id))
        .filter((n) => n.status === PENDING)
        .map((n) => [
          n.recipientUserId === patient.userId ? 'patient' : 'psychologist',
          n.type,
          n.startMinute,
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(pending).toEqual([
        ['patient', APPOINTMENT_REMINDER, minutes('15:00')],
        ['patient', APPOINTMENT_RESCHEDULE, minutes('15:00')],
        ['psychologist', APPOINTMENT_RESCHEDULE, minutes('15:00')],
      ]);
      const old = (await rows(appointment.id)).find(
        (n) =>
          n.type === APPOINTMENT_REMINDER && n.startMinute === minutes('09:00'),
      );
      expect([old?.status, old?.errorCode]).toEqual([CANCELLED, 'SUPERSEDED']);

      // Moving back to the original slot re-arms its reminder instead of failing.
      await appointments.reschedule(patient.userId, appointment.id, {
        appointmentDate: date,
        startTime: '09:00',
      });
      const again = await rows(appointment.id);
      expect(
        again
          .filter(
            (n) => n.type === APPOINTMENT_REMINDER && n.status === PENDING,
          )
          .map((n) => n.startMinute),
      ).toEqual([minutes('09:00')]);
      expect(
        again.filter((n) => n.type === APPOINTMENT_RESCHEDULE),
      ).toHaveLength(4);
    });

    it.each([AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])(
      '8-9: closing as %s cancels pending reminders',
      async (status) => {
        const patient = await fx.patient();
        const past = await fx.appointment(
          patient,
          psychologist,
          businessDatePlus(-1),
          minutes('08:00'),
        );
        await prisma.notification.create({
          data: {
            type: APPOINTMENT_REMINDER,
            recipientUserId: patient.userId,
            appointmentId: past.id,
            appointmentDate: businessDatePlus(-1),
            startMinute: minutes('08:00'),
            scheduledFor: new Date(Date.now() + DAY),
            idempotencyKey: `test-reminder-${past.id}`,
          },
        });
        await lifecycle.finish(psychologist.userId, past.id, status);
        const [reminder] = await rows(past.id);
        expect([reminder.status, reminder.errorCode]).toEqual([
          CANCELLED,
          'APPOINTMENT_CLOSED',
        ]);
      },
    );
  });

  describe('processor (cron run)', () => {
    beforeEach(async () => {
      // Isolation inside the disposable DB: earlier tests' messages are out of scope.
      await prisma.notification.updateMany({
        where: { status: { in: [PENDING, NotificationStatus.PROCESSING] } },
        data: { status: CANCELLED, errorCode: 'TEST_ISOLATION' },
      });
    });

    async function bookedPatient(
      daysAhead: number,
      time = '09:00',
      consent = false,
    ) {
      const patient = await fx.patient();
      if (consent)
        await prisma.patient.update({
          where: { id: patient.patientId },
          data: { emailRemindersEnabled: true },
        });
      const appointment = await book(
        patient,
        businessDatePlus(daysAhead),
        time,
      );
      return { patient, appointment };
    }

    it('14: NOTIFICATIONS_ENABLED=false sends nothing and touches nothing', async () => {
      const { appointment } = await bookedPatient(10);
      const sender = new FakeSender();
      const result = await new NotificationProcessor(
        prisma,
        sender,
        config({ enabled: false }),
      ).runOnce();
      expect(result.stoppedBy).toBe('disabled');
      expect(sender.sent).toHaveLength(0);
      expect(
        (await rows(appointment.id)).every(
          (n) => n.status === PENDING && n.attempts === 0,
        ),
      ).toBe(true);
    });

    it('2, 11: sends the confirmation to the patient and to the psychologist once; rerun does not resend', async () => {
      const { patient, appointment } = await bookedPatient(11);
      const sender = new FakeSender();
      const processor = new NotificationProcessor(prisma, sender, config());
      const first = await processor.runOnce();
      expect(first.accepted).toBe(2);
      const byRecipient = Object.fromEntries(sender.sent.map((m) => [m.to, m]));
      expect(byRecipient[patient.email].subject).toBe(
        'Confirmación de tu cita',
      );
      expect(byRecipient[patient.email].text).toContain('/appointments');
      expect(byRecipient[psychologist.email].subject).toBe(
        'Nueva cita agendada',
      );
      expect(byRecipient[psychologist.email].text).toContain(
        '/psychologist/appointments',
      );
      // The psychologist's message never names the patient.
      expect(byRecipient[psychologist.email].html).not.toContain(patient.email);
      const confirmations = (await rows(appointment.id)).filter(
        (n) => n.type === APPOINTMENT_CONFIRMATION,
      );
      expect(
        confirmations.every((n) => n.status === ACCEPTED && n.acceptedAt),
      ).toBe(true);
      // The patient reminder is not due yet.
      expect(
        (await rows(appointment.id)).find(
          (n) => n.type === APPOINTMENT_REMINDER,
        )?.status,
      ).toBe(PENDING);
      await processor.runOnce();
      expect(sender.sent).toHaveLength(2);
    });

    it('cancellation and reschedule reach both recipients with their own wording', async () => {
      const a = await bookedPatient(12, '13:00');
      const b = await bookedPatient(13, '13:00');
      await appointments.cancel(a.patient.userId, a.appointment.id, {});
      await appointments.reschedule(b.patient.userId, b.appointment.id, {
        appointmentDate: businessDatePlus(13),
        startTime: '16:00',
      });
      const sender = new FakeSender();
      await new NotificationProcessor(prisma, sender, config()).runOnce();
      const got = sender.sent
        .map((m) => [
          m.to === psychologist.email ? 'psychologist' : m.to,
          m.subject,
        ])
        .sort();
      expect(got).toEqual(
        [
          [a.patient.email, 'Cancelación de tu cita'],
          [b.patient.email, 'Cambio de horario de tu cita'],
          ['psychologist', 'Cita cancelada'],
          ['psychologist', 'Cita con nuevo horario'],
        ].sort(),
      );
    });

    it('10: two simultaneous runs never send the same message twice', async () => {
      for (let i = 0; i < 6; i++) await bookedPatient(14 + i, '10:00');
      const sender = new FakeSender();
      sender.delayMs = 30;
      const [a, b] = await Promise.all([
        new NotificationProcessor(prisma, sender, config()).runOnce(),
        new NotificationProcessor(prisma, sender, config()).runOnce(),
      ]);
      expect(a.claimed + b.claimed).toBe(12);
      expect(sender.sent).toHaveLength(12);
      expect(
        sender.sent.filter((m) => m.to === psychologist.email),
      ).toHaveLength(6);
      expect(
        new Set(
          sender.sent
            .filter((m) => m.to !== psychologist.email)
            .map((m) => m.to),
        ).size,
      ).toBe(6);
    });

    it('12: a transient SMTP failure is retried later with backoff; repeated failures end FAILED', async () => {
      const { patient, appointment } = await bookedPatient(20);
      const sender = new FakeSender();
      let clock = new Date();
      const processor = new NotificationProcessor(
        prisma,
        sender,
        config({ maxAttempts: 2 }),
        () => clock,
      );
      const patientConfirmation = async () =>
        (await rows(appointment.id)).find(
          (n) =>
            n.type === APPOINTMENT_CONFIRMATION &&
            n.recipientUserId === patient.userId,
        )!;
      sender.failures.push(
        new EmailDeliveryError('ETIMEDOUT', true),
        new EmailDeliveryError('ETIMEDOUT', true),
      );
      const first = await processor.runOnce();
      expect(first.retried).toBe(2);
      let confirmation = await patientConfirmation();
      expect([
        confirmation.status,
        confirmation.attempts,
        confirmation.errorCode,
      ]).toEqual([PENDING, 1, 'ETIMEDOUT']);
      expect(
        confirmation.scheduledFor.getTime() - clock.getTime(),
      ).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
      await processor.runOnce(); // not due yet: no immediate hammering of SMTP
      expect(sender.sent).toHaveLength(0);

      clock = new Date(clock.getTime() + 6 * 60_000);
      sender.failures.push(
        new EmailDeliveryError('ETIMEDOUT', true),
        new EmailDeliveryError('ETIMEDOUT', true),
      );
      await processor.runOnce();
      confirmation = await patientConfirmation();
      expect([confirmation.status, confirmation.attempts]).toEqual([FAILED, 2]);
    });

    it('permanent SMTP errors fail without retries', async () => {
      const { appointment } = await bookedPatient(21);
      const sender = new FakeSender();
      sender.failures.push(
        new EmailDeliveryError('SMTP_550', false),
        new EmailDeliveryError('SMTP_550', false),
      );
      const result = await new NotificationProcessor(
        prisma,
        sender,
        config(),
      ).runOnce();
      expect(result.failed).toBe(2);
      const confirmations = (await rows(appointment.id)).filter(
        (n) => n.type === APPOINTMENT_CONFIRMATION,
      );
      expect(
        confirmations.map((n) => [n.status, n.errorCode, n.attempts]),
      ).toEqual([
        [FAILED, 'SMTP_550', 1],
        [FAILED, 'SMTP_550', 1],
      ]);
    });

    it('checks the real appointment just before sending (cancelled / moved = not sent)', async () => {
      const { appointment } = await bookedPatient(22);
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.CANCELLED },
      });
      const sender = new FakeSender();
      await new NotificationProcessor(prisma, sender, config()).runOnce();
      expect(sender.sent).toHaveLength(0);
      const confirmations = (await rows(appointment.id)).filter(
        (n) => n.type === APPOINTMENT_CONFIRMATION,
      );
      expect(confirmations.map((n) => n.errorCode)).toEqual(['STALE', 'STALE']);
    });

    it('an inactive psychologist is skipped while the patient still gets the message', async () => {
      const other = await fx.psychologist();
      const patient = await fx.patient();
      const appointment = await appointments.create(patient.userId, {
        psychologistId: other.userId,
        appointmentDate: businessDatePlus(23),
        startTime: '09:00',
      });
      await prisma.user.update({
        where: { id: other.userId },
        data: { isActive: false },
      });
      const sender = new FakeSender();
      await new NotificationProcessor(prisma, sender, config()).runOnce();
      expect(sender.sent.map((m) => m.to)).toEqual([patient.email]);
      const psy = (await rows(appointment.id)).find(
        (n) => n.recipientUserId === other.userId,
      );
      expect([psy?.status, psy?.errorCode]).toEqual([
        CANCELLED,
        'RECIPIENT_INACTIVE',
      ]);
    });

    it('reminders: sent at the due time only with the patient’s opt-in', async () => {
      // Same day, one hour earlier: still in the future when the 09:00 reminder is due.
      const without = await bookedPatient(24, '08:00', false);
      const withConsent = await bookedPatient(24, '09:00', true);
      const sender = new FakeSender();
      await new NotificationProcessor(prisma, sender, config()).runOnce(); // confirmations
      sender.sent = [];
      const due = new Date(
        appointmentStartUtc(businessDatePlus(24), minutes('09:00')).getTime() -
          DAY +
          60_000,
      );
      await new NotificationProcessor(
        prisma,
        sender,
        config(),
        () => due,
      ).runOnce();
      expect(sender.sent.map((m) => [m.to, m.subject])).toEqual([
        [withConsent.patient.email, 'Recordatorio de cita'],
      ]);
      const skipped = (await rows(without.appointment.id)).find(
        (n) => n.type === APPOINTMENT_REMINDER,
      );
      expect([skipped?.status, skipped?.errorCode]).toEqual([
        CANCELLED,
        'NO_CONSENT',
      ]);
    });

    it('staging allowlist: recipients outside it are never contacted', async () => {
      const { appointment } = await bookedPatient(25);
      const sender = new FakeSender();
      await new NotificationProcessor(
        prisma,
        sender,
        config({ recipientAllowlist: ['solo-esta@example.org'] }),
      ).runOnce();
      expect(sender.sent).toHaveLength(0);
      expect(
        (await rows(appointment.id))
          .filter((n) => n.type === APPOINTMENT_CONFIRMATION)
          .map((n) => n.errorCode),
      ).toEqual(['NOT_ALLOWLISTED', 'NOT_ALLOWLISTED']);
    });

    it('20: batch, daily quota and time budget bound each run', async () => {
      for (let i = 0; i < 3; i++) await bookedPatient(26 + i, '12:00');
      const sender = new FakeSender();
      const batch = await new NotificationProcessor(
        prisma,
        sender,
        config({ batchSize: 2 }),
      ).runOnce();
      expect([batch.claimed, sender.sent.length]).toEqual([2, 2]);

      const quota = await new NotificationProcessor(
        prisma,
        sender,
        config({ dailyLimit: sender.sent.length + 1 }),
      ).runOnce();
      expect(quota.claimed).toBeLessThanOrEqual(1);

      const timed = await new NotificationProcessor(
        prisma,
        sender,
        config({ maxRuntimeMs: -1 }),
      ).runOnce();
      expect(timed.stoppedBy).toBe('time_budget');
      expect(timed.released).toBe(timed.claimed);
      const pending = await prisma.notification.findMany({
        where: { status: PENDING, type: APPOINTMENT_CONFIRMATION },
      });
      expect(pending.every((n) => n.attempts === 0)).toBe(true);
    });

    it('recovers a claim left by an interrupted run (expired lease)', async () => {
      const { patient, appointment } = await bookedPatient(30);
      const confirmation = (await rows(appointment.id)).find(
        (n) =>
          n.type === APPOINTMENT_CONFIRMATION &&
          n.recipientUserId === patient.userId,
      )!;
      await prisma.notification.update({
        where: { id: confirmation.id },
        data: {
          status: NotificationStatus.PROCESSING,
          attempts: 1,
          lockedUntil: new Date(Date.now() - 60_000),
        },
      });
      const sender = new FakeSender();
      const result = await new NotificationProcessor(
        prisma,
        sender,
        config(),
      ).runOnce();
      expect(result.recovered).toBe(1);
      expect(sender.sent.map((m) => m.to).sort()).toEqual(
        [patient.email, psychologist.email].sort(),
      );
    });

    it('per-person daily caps: patients and psychologists have their own limit', async () => {
      // Fresh people: the shared psychologist already received mail in earlier tests.
      const own = await fx.psychologist();
      const patient = await fx.patient();
      for (const day of [31, 32, 33])
        await appointments.create(patient.userId, {
          psychologistId: own.userId,
          appointmentDate: businessDatePlus(day),
          startTime: '17:00',
        });
      const sender = new FakeSender();
      await new NotificationProcessor(
        prisma,
        sender,
        config({ perRecipientDailyLimit: 1, psychologistDailyLimit: 2 }),
      ).runOnce();
      expect(sender.sent.filter((m) => m.to === patient.email)).toHaveLength(1);
      expect(sender.sent.filter((m) => m.to === own.email)).toHaveLength(2);
      expect(
        await prisma.notification.count({
          where: {
            errorCode: 'RECIPIENT_DAILY_LIMIT',
            recipientUserId: { in: [patient.userId, own.userId] },
          },
        }),
      ).toBe(3);
    });
  });
});
