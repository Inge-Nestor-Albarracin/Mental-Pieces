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
  const appointments = new AppointmentsService(prisma);
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
      orderBy: { createdAt: 'asc' },
    });

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

  describe('outbox (written in the appointment transaction)', () => {
    it('1-2: booking queues a confirmation and a reminder for the owner', async () => {
      const patient = await fx.patient();
      const date = businessDatePlus(5);
      const appointment = await book(patient, date, '09:00');
      const queued = await rows(appointment.id);
      expect(queued.map((n) => [n.type, n.status])).toEqual([
        [NotificationType.APPOINTMENT_CONFIRMATION, NotificationStatus.PENDING],
        [NotificationType.APPOINTMENT_REMINDER, NotificationStatus.PENDING],
      ]);
      expect(queued.every((n) => n.recipientUserId === patient.userId)).toBe(
        true,
      );
      const reminder = queued[1];
      expect(reminder.scheduledFor.toISOString()).toBe(
        new Date(
          appointmentStartUtc(date, minutes('09:00')).getTime() - DAY,
        ).toISOString(),
      );
      expect(reminder.channel).toBe('EMAIL');
    });

    it('16: booked with less than 24 h left: confirmation only, no retroactive reminder', async () => {
      const patient = await fx.patient();
      const slot = slotWithin24h();
      const appointment = await book(patient, slot.date, slot.time);
      expect((await rows(appointment.id)).map((n) => n.type)).toEqual([
        NotificationType.APPOINTMENT_CONFIRMATION,
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
      await Promise.allSettled([
        book(a, date, '11:00'),
        book(b, date, '11:00'),
      ]);
      const owners = await prisma.notification.findMany({
        where: { recipientUserId: { in: [a.userId, b.userId] } },
        select: { recipientUserId: true },
      });
      expect(owners).toHaveLength(2);
      expect(new Set(owners.map((o) => o.recipientUserId)).size).toBe(1);
    });

    it('5: cancelling drops pending reminders and queues a cancellation', async () => {
      const patient = await fx.patient();
      const appointment = await book(patient, businessDatePlus(8), '09:00');
      await appointments.cancel(patient.userId, appointment.id, {});
      const queued = await rows(appointment.id);
      expect(queued.map((n) => [n.type, n.status, n.errorCode])).toEqual([
        [
          NotificationType.APPOINTMENT_CONFIRMATION,
          NotificationStatus.CANCELLED,
          'APPOINTMENT_CANCELLED',
        ],
        [
          NotificationType.APPOINTMENT_REMINDER,
          NotificationStatus.CANCELLED,
          'APPOINTMENT_CANCELLED',
        ],
        [
          NotificationType.APPOINTMENT_CANCELLATION,
          NotificationStatus.PENDING,
          null,
        ],
      ]);
    });

    it('6-7: rescheduling invalidates the old reminder and schedules the new one', async () => {
      const patient = await fx.patient();
      const date = businessDatePlus(9);
      const appointment = await book(patient, date, '09:00');
      await appointments.reschedule(patient.userId, appointment.id, {
        appointmentDate: date,
        startTime: '15:00',
      });
      const queued = await rows(appointment.id);
      const pending = queued.filter(
        (n) => n.status === NotificationStatus.PENDING,
      );
      expect(pending.map((n) => [n.type, n.startMinute])).toEqual([
        [NotificationType.APPOINTMENT_RESCHEDULE, minutes('15:00')],
        [NotificationType.APPOINTMENT_REMINDER, minutes('15:00')],
      ]);
      const old = queued.find(
        (n) =>
          n.type === NotificationType.APPOINTMENT_REMINDER &&
          n.startMinute === minutes('09:00'),
      );
      expect([old?.status, old?.errorCode]).toEqual([
        NotificationStatus.CANCELLED,
        'SUPERSEDED',
      ]);

      // Moving back to the original slot re-arms its reminder instead of failing.
      await appointments.reschedule(patient.userId, appointment.id, {
        appointmentDate: date,
        startTime: '09:00',
      });
      const again = await rows(appointment.id);
      const reminders = again.filter(
        (n) => n.type === NotificationType.APPOINTMENT_REMINDER,
      );
      expect(
        reminders
          .filter((n) => n.status === NotificationStatus.PENDING)
          .map((n) => n.startMinute),
      ).toEqual([minutes('09:00')]);
      expect(
        again.filter((n) => n.type === NotificationType.APPOINTMENT_RESCHEDULE),
      ).toHaveLength(2);
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
            type: NotificationType.APPOINTMENT_REMINDER,
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
          NotificationStatus.CANCELLED,
          'APPOINTMENT_CLOSED',
        ]);
      },
    );
  });

  describe('processor (cron run)', () => {
    beforeEach(async () => {
      // Isolation inside the disposable DB: earlier tests' messages are out of scope.
      await prisma.notification.updateMany({
        where: {
          status: {
            in: [NotificationStatus.PENDING, NotificationStatus.PROCESSING],
          },
        },
        data: {
          status: NotificationStatus.CANCELLED,
          errorCode: 'TEST_ISOLATION',
        },
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
      const summary = await new NotificationProcessor(
        prisma,
        sender,
        config({ enabled: false }),
      ).runOnce();
      expect(summary.stoppedBy).toBe('disabled');
      expect(sender.sent).toHaveLength(0);
      expect(
        (await rows(appointment.id)).every(
          (n) => n.status === NotificationStatus.PENDING && n.attempts === 0,
        ),
      ).toBe(true);
    });

    it('2, 11: sends due confirmations to the owner’s address once; rerunning does not resend', async () => {
      const { patient, appointment } = await bookedPatient(11);
      const sender = new FakeSender();
      const processor = new NotificationProcessor(prisma, sender, config());
      const first = await processor.runOnce();
      expect(first.accepted).toBe(1);
      expect(sender.sent.map((m) => [m.to, m.subject])).toEqual([
        [patient.email, 'Confirmación de tu cita'],
      ]);
      const confirmation = (await rows(appointment.id))[0];
      expect(confirmation.status).toBe(NotificationStatus.ACCEPTED);
      expect(confirmation.acceptedAt).toBeInstanceOf(Date);
      expect(confirmation.providerMessageId).toBe('<fake-1@test>');
      // The reminder is not due yet.
      expect((await rows(appointment.id))[1].status).toBe(
        NotificationStatus.PENDING,
      );
      await processor.runOnce();
      expect(sender.sent).toHaveLength(1);
    });

    it('10: two simultaneous runs never send the same message twice', async () => {
      for (let i = 0; i < 6; i++) await bookedPatient(12 + i, '10:00');
      const sender = new FakeSender();
      sender.delayMs = 30;
      const [a, b] = await Promise.all([
        new NotificationProcessor(prisma, sender, config()).runOnce(),
        new NotificationProcessor(prisma, sender, config()).runOnce(),
      ]);
      expect(a.claimed + b.claimed).toBe(6);
      expect(sender.sent).toHaveLength(6);
      expect(new Set(sender.sent.map((m) => m.to)).size).toBe(6);
    });

    it('12: a transient SMTP failure is retried later with backoff; repeated failures end FAILED', async () => {
      const { appointment } = await bookedPatient(18);
      const sender = new FakeSender();
      let clock = new Date();
      const processor = new NotificationProcessor(
        prisma,
        sender,
        config({ maxAttempts: 2 }),
        () => clock,
      );
      sender.failures.push(new EmailDeliveryError('ETIMEDOUT', true));
      const first = await processor.runOnce();
      expect(first.retried).toBe(1);
      let [confirmation] = await rows(appointment.id);
      expect([
        confirmation.status,
        confirmation.attempts,
        confirmation.errorCode,
      ]).toEqual([NotificationStatus.PENDING, 1, 'ETIMEDOUT']);
      expect(
        confirmation.scheduledFor.getTime() - clock.getTime(),
      ).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
      await processor.runOnce(); // not due yet: no immediate hammering of SMTP
      expect(sender.sent).toHaveLength(0);

      clock = new Date(clock.getTime() + 6 * 60_000);
      sender.failures.push(new EmailDeliveryError('ETIMEDOUT', true));
      await processor.runOnce();
      [confirmation] = await rows(appointment.id);
      expect([confirmation.status, confirmation.attempts]).toEqual([
        NotificationStatus.FAILED,
        2,
      ]);
    });

    it('permanent SMTP errors fail without retries', async () => {
      const { appointment } = await bookedPatient(19);
      const sender = new FakeSender();
      sender.failures.push(new EmailDeliveryError('SMTP_550', false));
      const summary = await new NotificationProcessor(
        prisma,
        sender,
        config(),
      ).runOnce();
      expect(summary.failed).toBe(1);
      const [confirmation] = await rows(appointment.id);
      expect([
        confirmation.status,
        confirmation.errorCode,
        confirmation.attempts,
      ]).toEqual([NotificationStatus.FAILED, 'SMTP_550', 1]);
    });

    it('checks the real appointment just before sending (cancelled / moved = not sent)', async () => {
      const { appointment } = await bookedPatient(20);
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.CANCELLED },
      });
      const sender = new FakeSender();
      await new NotificationProcessor(prisma, sender, config()).runOnce();
      expect(sender.sent).toHaveLength(0);
      expect((await rows(appointment.id))[0].errorCode).toBe('STALE');
    });

    it('reminders: sent at the due time only with the patient’s opt-in', async () => {
      // Same day, one hour earlier: still in the future when the 09:00 reminder is due.
      const without = await bookedPatient(22, '08:00', false);
      const withConsent = await bookedPatient(22, '09:00', true);
      const sender = new FakeSender();
      await new NotificationProcessor(prisma, sender, config()).runOnce(); // confirmations
      sender.sent = [];
      const due = new Date(
        appointmentStartUtc(businessDatePlus(22), minutes('09:00')).getTime() -
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
        (n) => n.type === NotificationType.APPOINTMENT_REMINDER,
      );
      expect([skipped?.status, skipped?.errorCode]).toEqual([
        NotificationStatus.CANCELLED,
        'NO_CONSENT',
      ]);
    });

    it('staging allowlist: recipients outside it are never contacted', async () => {
      const { appointment } = await bookedPatient(23);
      const sender = new FakeSender();
      await new NotificationProcessor(
        prisma,
        sender,
        config({ recipientAllowlist: ['solo-esta@example.org'] }),
      ).runOnce();
      expect(sender.sent).toHaveLength(0);
      expect((await rows(appointment.id))[0].errorCode).toBe('NOT_ALLOWLISTED');
    });

    it('20: batch, daily quota and time budget bound each run', async () => {
      for (let i = 0; i < 5; i++) await bookedPatient(24 + i, '12:00');
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
        where: {
          status: NotificationStatus.PENDING,
          type: NotificationType.APPOINTMENT_CONFIRMATION,
        },
      });
      expect(pending.every((n) => n.attempts === 0)).toBe(true);
    });

    it('recovers a claim left by an interrupted run (expired lease)', async () => {
      const { appointment } = await bookedPatient(30);
      const [confirmation] = await rows(appointment.id);
      await prisma.notification.update({
        where: { id: confirmation.id },
        data: {
          status: NotificationStatus.PROCESSING,
          attempts: 1,
          lockedUntil: new Date(Date.now() - 60_000),
        },
      });
      const sender = new FakeSender();
      const summary = await new NotificationProcessor(
        prisma,
        sender,
        config(),
      ).runOnce();
      expect(summary.recovered).toBe(1);
      expect(sender.sent).toHaveLength(1);
    });

    it('per-recipient daily cap limits mail to one person', async () => {
      const { patient, appointment } = await bookedPatient(31);
      await appointments.reschedule(patient.userId, appointment.id, {
        appointmentDate: businessDatePlus(31),
        startTime: '16:00',
      });
      const sender = new FakeSender();
      await new NotificationProcessor(
        prisma,
        sender,
        config({ perRecipientDailyLimit: 1 }),
      ).runOnce();
      expect(sender.sent).toHaveLength(1);
    });
  });
});
