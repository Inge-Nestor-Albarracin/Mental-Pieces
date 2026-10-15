import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../generated/prisma/client';
import { UserRole, WeekDay } from '../generated/prisma/enums';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { AppointmentsController } from '../src/modules/appointments/appointments.controller';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';

// Wednesday 2026-10-14 15:00 in America/Bogota (UTC-5).
const NOW = new Date('2026-10-14T20:00:00Z');
const PAST_MESSAGE = 'No puedes agendar una cita en una fecha u hora pasada.';
const psychologistUserId = `c${'2'.repeat(24)}`;
const staffProfileId = `c${'9'.repeat(24)}`;
const patientId = `c${'1'.repeat(24)}`;
const appointmentId = `c${'8'.repeat(24)}`;

describe('Appointments: business time in America/Bogota (no real database)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let availability: Partial<Record<WeekDay, [number, number][]>> = {};
  const appointment = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn<Promise<unknown>, [Prisma.AppointmentCreateArgs]>(),
    update: jest.fn<Promise<unknown>, [Prisma.AppointmentUpdateArgs]>(),
  };
  const database = {
    appointment,
    patient: { findUnique: jest.fn() },
    user: {
      findUnique: jest.fn<
        Promise<unknown>,
        [{ where: { id: string }; select: Record<string, unknown> }]
      >(),
    },
    psychologistAvailability: {
      findMany: jest.fn(
        (args: { where: { dayOfWeek: WeekDay; psychologistId: string } }) =>
          Promise.resolve(
            (args.where.psychologistId === psychologistUserId
              ? (availability[args.where.dayOfWeek] ?? [])
              : []
            ).map(([startMinute, endMinute]) => ({ startMinute, endMinute })),
          ),
      ),
    },
    careRelationship: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(
      (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        operation({ appointment } as unknown as Prisma.TransactionClient),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('hex') }),
      ],
      controllers: [AppointmentsController],
      providers: [
        AppointmentsService,
        JwtAuthGuard,
        RolesGuard,
        { provide: PrismaService, useValue: database },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = module.get(JwtService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Only Date is faked; real timers keep supertest/http working.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    availability = { WEDNESDAY: [[360, 1080]], THURSDAY: [[360, 1080]] };
    database.patient.findUnique.mockResolvedValue({ id: patientId });
    // Appointment.psychologistId is a User id; a StaffProfile id is not a user.
    database.user.findUnique.mockImplementation(({ where, select }) =>
      Promise.resolve(
        where.id === psychologistUserId
          ? {
              id: psychologistUserId,
              role: UserRole.PSYCHOLOGIST,
              isActive: true,
              staffProfile: { fullName: 'Psicólogo sintético' },
            }
          : select.role && where.id === 'patient-test-user'
            ? { role: UserRole.PATIENT }
            : null,
      ),
    );
    appointment.findFirst.mockResolvedValue(null);
    appointment.findMany.mockResolvedValue([]);
    appointment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: appointmentId, ...data, createdAt: NOW }),
    );
    appointment.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: appointmentId, ...data }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(async () => {
    await app.close();
  });

  const patient = () =>
    `Bearer ${jwt.sign({ sub: 'patient-test-user', role: UserRole.PATIENT, email: 'synthetic@example.invalid' })}`;

  function book(
    appointmentDate: string,
    startTime: string,
    id = psychologistUserId,
  ) {
    return request(app.getHttpServer())
      .post('/appointments/me')
      .set('Authorization', patient())
      .send({ psychologistId: id, appointmentDate, startTime });
  }

  function slots(date: string) {
    return request(app.getHttpServer())
      .get('/appointments/available-slots')
      .query({ psychologistId: psychologistUserId, date })
      .set('Authorization', patient());
  }

  describe('creation', () => {
    it.each([
      ['yesterday', '2026-10-13', '10:00'],
      ['today, already started', '2026-10-14', '08:00'],
      ['today, starting right now', '2026-10-14', '15:00'],
    ])('rejects %s even inside availability', async (_label, date, time) => {
      const response = await book(date, time).expect(400);
      expect(response.body).toHaveProperty('message', PAST_MESSAGE);
      expect(appointment.create).not.toHaveBeenCalled();
    });

    it.each([
      ['later today', '2026-10-14', '16:00', 960],
      ['tomorrow', '2026-10-15', '09:00', 540],
    ])('accepts %s within availability', async (_label, date, time, minute) => {
      const response = await book(date, time).expect(201);
      expect(response.body).toMatchObject({
        appointmentDate: date,
        startTime: time,
        status: 'SCHEDULED',
        psychologist: { id: psychologistUserId },
      });
      expect(appointment.create.mock.calls[0]?.[0].data).toMatchObject({
        patientId,
        psychologistId: psychologistUserId,
        appointmentDate: date,
        startMinute: minute,
        endMinute: minute + 60,
      });
      expect(database.careRelationship.create).not.toHaveBeenCalled();
      expect(database.careRelationship.findFirst).not.toHaveBeenCalled();
    });

    it('a StaffProfile id is not a psychologist id (regression)', async () => {
      await book('2026-10-15', '09:00', staffProfileId).expect(404);
      expect(appointment.create).not.toHaveBeenCalled();
    });

    it('rejects impossible calendar dates instead of rolling them over', async () => {
      await book('2026-02-30', '09:00').expect(400);
      expect(appointment.create).not.toHaveBeenCalled();
    });

    it('rejects a time outside the availability of that weekday', async () => {
      await book('2026-10-16', '09:00').expect(400); // Friday: no block.
      expect(appointment.create).not.toHaveBeenCalled();
    });

    it('stays correct when the server process runs in UTC', async () => {
      const previous = process.env.TZ;
      process.env.TZ = 'UTC';
      try {
        // 12:00 Bogotá already passed at 15:00; a double timezone conversion allowed it.
        await book('2026-10-14', '12:00').expect(400);
        await book('2026-10-14', '16:00').expect(201);
      } finally {
        process.env.TZ = previous;
      }
    });

    it('returns 409 when the psychologist already has that slot', async () => {
      appointment.findFirst.mockResolvedValueOnce({ id: 'synthetic-other' });
      await book('2026-10-15', '09:00').expect(409);
      expect(appointment.create).not.toHaveBeenCalled();
    });
  });

  describe('available slots', () => {
    it('today offers only slots that have not started (now 15:00)', async () => {
      const response = await slots('2026-10-14').expect(200);
      expect(response.body).toEqual(['16:00', '17:00']);
      expect(
        database.psychologistAvailability.findMany.mock.calls[0]?.[0],
      ).toMatchObject({
        where: { psychologistId: psychologistUserId, dayOfWeek: 'WEDNESDAY' },
      });
    });

    it('at 14:35 the 15:00 slot is still offered, 14:00 is not', async () => {
      jest.setSystemTime(new Date('2026-10-14T19:35:00Z'));
      const response = await slots('2026-10-14').expect(200);
      expect(response.body).toEqual(['15:00', '16:00', '17:00']);
    });

    it('excludes occupied slots', async () => {
      appointment.findMany.mockResolvedValue([
        { startMinute: 960, endMinute: 1020 },
      ]);
      const response = await slots('2026-10-14').expect(200);
      expect(response.body).toEqual(['17:00']);
    });

    it('a weekday without availability returns an empty list, not an error', async () => {
      availability = { MONDAY: [[360, 1080]] };
      const response = await slots('2026-10-20').expect(200); // Tuesday.
      expect(response.body).toEqual([]);
      expect(
        database.psychologistAvailability.findMany.mock.calls[0]?.[0],
      ).toMatchObject({ where: { dayOfWeek: 'TUESDAY' } });
    });

    it('past dates return no slots', async () => {
      const response = await slots('2026-10-07').expect(200);
      expect(response.body).toEqual([]);
    });

    it('weekday does not depend on the server timezone', async () => {
      const previous = process.env.TZ;
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      try {
        await slots('2026-10-21').expect(200);
        expect(
          database.psychologistAvailability.findMany.mock.calls[0]?.[0],
        ).toMatchObject({ where: { dayOfWeek: 'WEDNESDAY' } });
      } finally {
        process.env.TZ = previous;
      }
    });

    it('a StaffProfile id returns 404', async () => {
      await request(app.getHttpServer())
        .get('/appointments/available-slots')
        .query({ psychologistId: staffProfileId, date: '2026-10-15' })
        .set('Authorization', patient())
        .expect(404);
    });
  });

  describe('reschedule', () => {
    const existing = {
      id: appointmentId,
      patientId,
      psychologistId: psychologistUserId,
      appointmentDate: '2026-10-15',
      startMinute: 540,
      status: 'SCHEDULED',
    };

    function move(appointmentDate: string, startTime: string) {
      return request(app.getHttpServer())
        .patch(`/appointments/me/${appointmentId}/reschedule`)
        .set('Authorization', patient())
        .send({ appointmentDate, startTime });
    }

    beforeEach(() => {
      appointment.findUnique.mockResolvedValue({ ...existing });
    });

    it.each([
      ['2026-10-13', '10:00'],
      ['2026-10-14', '08:00'],
      ['2026-10-14', '15:00'],
    ])('rejects moving to the past (%s %s)', async (date, time) => {
      const response = await move(date, time).expect(400);
      expect(response.body).toHaveProperty('message', PAST_MESSAGE);
      expect(appointment.update).not.toHaveBeenCalled();
    });

    it('accepts a future slot within availability', async () => {
      await move('2026-10-14', '17:00').expect(200);
      expect(appointment.update.mock.calls[0]?.[0].data).toMatchObject({
        appointmentDate: '2026-10-14',
        startMinute: 1020,
        endMinute: 1080,
      });
    });

    it('rejects moving an appointment that already started', async () => {
      appointment.findUnique.mockResolvedValue({
        ...existing,
        appointmentDate: '2026-10-14',
        startMinute: 840, // 14:00, in progress at 15:00
      });
      await move('2026-10-15', '10:00').expect(400);
      expect(appointment.update).not.toHaveBeenCalled();
    });

    it('another patient gets 404 (BOLA)', async () => {
      appointment.findUnique.mockResolvedValue({
        ...existing,
        patientId: 'cotherpatient000000000000',
      });
      await move('2026-10-15', '10:00').expect(404);
      expect(appointment.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it.each([
      ['future SCHEDULED', '2026-10-15', 'SCHEDULED', 200],
      ['past SCHEDULED', '2026-09-28', 'SCHEDULED', 400],
      ['COMPLETED', '2026-10-15', 'COMPLETED', 400],
      ['NO_SHOW', '2026-10-15', 'NO_SHOW', 400],
      ['CANCELLED', '2026-10-15', 'CANCELLED', 400],
    ])('%s → %s', async (_label, appointmentDate, status, expected) => {
      appointment.findUnique.mockResolvedValue({
        id: appointmentId,
        patientId,
        appointmentDate,
        startMinute: 540,
        status,
      });
      appointment.update.mockResolvedValue({
        id: appointmentId,
        appointmentDate,
        startMinute: 540,
        endMinute: 600,
        status: 'CANCELLED',
        cancelledAt: NOW,
        cancellationReason: null,
      });
      await request(app.getHttpServer())
        .patch(`/appointments/me/${appointmentId}/cancel`)
        .set('Authorization', patient())
        .send({})
        .expect(expected);
      expect(appointment.update).toHaveBeenCalledTimes(
        expected === 200 ? 1 : 0,
      );
    });
  });

  it('rejects client-supplied identity or status on creation', async () => {
    for (const field of ['patientId', 'status', 'endTime']) {
      await request(app.getHttpServer())
        .post('/appointments/me')
        .set('Authorization', patient())
        .send({
          psychologistId: psychologistUserId,
          appointmentDate: '2026-10-15',
          startTime: '09:00',
          [field]: 'untrusted',
        })
        .expect(400);
    }
    expect(appointment.create).not.toHaveBeenCalled();
  });
});
