import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import { AppointmentStatus, UserRole } from '../generated/prisma/enums';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { AppointmentLifecycleController } from '../src/modules/appointments/appointment-lifecycle.controller';
import { AppointmentLifecycleService } from '../src/modules/appointments/appointment-lifecycle.service';
import { AppointmentsController } from '../src/modules/appointments/appointments.controller';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';

const id = `c${'8'.repeat(24)}`;
const psychologistId = `c${'2'.repeat(24)}`;
const patientId = `c${'1'.repeat(24)}`;
const initial = {
  id,
  patientId,
  psychologistId,
  appointmentDate: '2000-01-01',
  startMinute: 540,
  endMinute: 600,
  status: AppointmentStatus.SCHEDULED as AppointmentStatus,
};
const missingUpdate = () =>
  new PrismaClientKnownRequestError('synthetic concurrent change', {
    code: 'P2025',
    clientVersion: '7.8.0',
  });
const actions = ['complete', 'no-show'] as const;

describe('Appointment lifecycle HTTP (no real database)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let row = { ...initial };
  const appointment = {
    findFirst: jest.fn<
      Promise<typeof row | null>,
      [Prisma.AppointmentFindFirstArgs]
    >(),
    findUnique: jest.fn(),
    updateMany: jest.fn<
      Promise<{ count: number }>,
      [Prisma.AppointmentUpdateManyArgs]
    >(),
    update: jest.fn<Promise<unknown>, [Prisma.AppointmentUpdateArgs]>(),
  };
  const auditLog = { create: jest.fn() };
  const tx = { appointment, auditLog };
  const database = {
    ...tx,
    patient: { findUnique: jest.fn() },
    psychologistAvailability: { findMany: jest.fn() },
    careRelationship: { create: jest.fn() },
    $transaction: jest.fn(
      (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(tx as unknown as Prisma.TransactionClient),
    ),
  };

  function conditionalFinish(args: Prisma.AppointmentUpdateManyArgs) {
    const where = args.where;
    if (
      where?.id !== row.id ||
      where.psychologistId !== row.psychologistId ||
      where.status !== row.status ||
      where.appointmentDate !== row.appointmentDate ||
      where.startMinute !== row.startMinute ||
      where.endMinute !== row.endMinute
    )
      return Promise.resolve({ count: 0 });
    if (typeof args.data.status === 'string') row.status = args.data.status;
    return Promise.resolve({ count: 1 });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('hex') }),
      ],
      controllers: [AppointmentLifecycleController, AppointmentsController],
      providers: [
        AppointmentLifecycleService,
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
    row = { ...initial };
    appointment.findFirst.mockImplementation((args) =>
      Promise.resolve(
        args.where?.id === row.id &&
          args.where.psychologistId === row.psychologistId
          ? { ...row }
          : null,
      ),
    );
    appointment.findUnique.mockResolvedValue({ ...initial });
    appointment.updateMany.mockImplementation(conditionalFinish);
    appointment.update.mockResolvedValue({ ...initial });
    auditLog.create.mockResolvedValue({ id: 'synthetic-audit' });
    database.patient.findUnique.mockResolvedValue({ id: patientId });
    database.psychologistAvailability.findMany.mockResolvedValue([
      { startMinute: 0, endMinute: 1440 },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });

  function session(
    role = UserRole.PSYCHOLOGIST as UserRole,
    sub = psychologistId,
  ) {
    return `Bearer ${jwt.sign({ sub, role, email: 'synthetic@example.invalid' })}`;
  }
  function finish(
    action: (typeof actions)[number],
    auth = session(),
    appointmentId = id,
  ) {
    return request(app.getHttpServer())
      .patch(`/appointments/psychologist/me/${appointmentId}/${action}`)
      .set('Authorization', auth);
  }

  it.each(actions)(
    'the owner can %s a past scheduled appointment with a minimal response and audit',
    async (action) => {
      const status = action === 'complete' ? 'COMPLETED' : 'NO_SHOW';
      const response = await finish(action)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(response.body).toEqual({
        id,
        appointmentDate: '2000-01-01',
        startTime: '09:00',
        endTime: '10:00',
        status,
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: psychologistId,
          action: `APPOINTMENT_${status}`,
          resourceType: 'Appointment',
          resourceId: id,
        },
        select: { id: true },
      });
      expect(database.careRelationship.create).not.toHaveBeenCalled();
      expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(appointment.updateMany.mock.calls[0]?.[0]).toMatchObject({
        where: {
          id,
          psychologistId,
          status: 'SCHEDULED',
          appointmentDate: initial.appointmentDate,
          startMinute: initial.startMinute,
          endMinute: initial.endMinute,
          psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
        },
      });
    },
  );

  it.each(actions)(
    '%s returns the same 404 for another psychologist and a nonexistent id',
    async (action) => {
      const foreign = await finish(
        action,
        session(UserRole.PSYCHOLOGIST, 'other-test-psychologist'),
      ).expect(404);
      const missing = await finish(action, session(), 'unknown-test-id').expect(
        404,
      );
      expect(foreign.body).toEqual(missing.body);
      expect(appointment.updateMany).not.toHaveBeenCalled();
      expect(row.status).toBe('SCHEDULED');
    },
  );

  it.each([UserRole.PATIENT, UserRole.STAFF, UserRole.ADMIN])(
    '%s cannot execute either transition',
    async (role) => {
      for (const action of actions)
        await finish(action, session(role)).expect(403);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects missing/invalid JWT without touching the database', async () => {
    await request(app.getHttpServer())
      .patch(`/appointments/psychologist/me/${id}/complete`)
      .expect(401);
    await finish('no-show', 'Bearer invalid-synthetic-token').expect(401);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each(actions)(
    '%s rejects an inactive psychologist despite previously issued JWT',
    async (action) => {
      appointment.findFirst.mockResolvedValue(null);
      await finish(action).expect(404);
      expect(appointment.findFirst.mock.calls[0]?.[0]).toMatchObject({
        where: {
          id,
          psychologistId,
          psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
        },
      });
    },
  );

  it.each(actions)('%s rejects a future appointment', async (action) => {
    row.appointmentDate = '2999-01-01';
    await finish(action).expect(400);
    expect(appointment.updateMany).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
  ])('%s cannot transition again to either final state', async (status) => {
    row.status = status;
    for (const action of actions) await finish(action).expect(400);
    expect(appointment.updateMany).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['status', 'patientId', 'psychologistId', 'completedAt', 'role'])(
    'rejects the extra body/query field %s',
    async (field) => {
      for (const action of actions) {
        await finish(action)
          .send({ [field]: 'untrusted' })
          .expect(400);
        await finish(action)
          .query({ [field]: 'untrusted' })
          .expect(400);
      }
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['complete', 'complete'],
    ['complete', 'no-show'],
    ['no-show', 'no-show'],
  ] as const)(
    'only one of concurrent %s/%s succeeds, even after both read SCHEDULED',
    async (first, second) => {
      let release: () => void = () => undefined;
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reads = 0;
      appointment.findFirst.mockImplementation(async () => {
        const snapshot = { ...row };
        reads++;
        if (reads === 2) release();
        await bothRead;
        return snapshot;
      });
      const responses = await Promise.all([finish(first), finish(second)]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      expect(auditLog.create).toHaveBeenCalledTimes(1);
      expect(appointment.updateMany).toHaveBeenCalledTimes(2);
    },
  );

  it('cannot complete an appointment rescheduled between read and write', async () => {
    appointment.updateMany.mockImplementationOnce((args) => {
      row.appointmentDate = '2999-01-01';
      return conditionalFinish(args);
    });
    await finish('complete').expect(400);
    expect(row.status).toBe('SCHEDULED');
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('fails the operation if the audit write fails', async () => {
    auditLog.create.mockRejectedValue(new Error('synthetic-storage-failure'));
    await finish('complete').expect(500);
    // PostgreSQL supplies rollback; this in-memory fake is not a rollback test.
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('retries a serialization conflict without logging details', async () => {
    appointment.findFirst.mockRejectedValueOnce(
      new PrismaClientKnownRequestError('synthetic conflict', {
        code: 'P2034',
        clientVersion: '7.8.0',
      }),
    );
    await finish('complete').expect(200);
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('a stale patient cancellation cannot overwrite a completed appointment', async () => {
    appointment.update.mockImplementationOnce(() => {
      row.status = AppointmentStatus.COMPLETED;
      return Promise.reject(missingUpdate());
    });
    await request(app.getHttpServer())
      .patch(`/appointments/me/${id}/cancel`)
      .set('Authorization', session(UserRole.PATIENT, 'patient-test-user'))
      .send({})
      .expect(400);
    expect(appointment.update.mock.calls[0]?.[0] as unknown).toMatchObject({
      where: { id, patientId, status: 'SCHEDULED' },
    });
    expect(row.status).toBe('COMPLETED');
  });

  it('a stale reschedule cannot reopen a completed appointment', async () => {
    appointment.update.mockImplementationOnce(() => {
      row.status = AppointmentStatus.COMPLETED;
      return Promise.reject(missingUpdate());
    });
    await request(app.getHttpServer())
      .patch(`/appointments/me/${id}/reschedule`)
      .set('Authorization', session(UserRole.PATIENT, 'patient-test-user'))
      .send({ appointmentDate: '2999-01-01', startTime: '09:00' })
      .expect(400);
    expect(appointment.update.mock.calls[0]?.[0] as unknown).toMatchObject({
      where: {
        id,
        patientId,
        psychologistId,
        status: 'SCHEDULED',
        appointmentDate: initial.appointmentDate,
        startMinute: initial.startMinute,
      },
    });
    expect(row.status).toBe('COMPLETED');
  });

  it.each([AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])(
    'patient cannot cancel or reschedule %s',
    async (status) => {
      appointment.findUnique.mockResolvedValue({ ...initial, status });
      const auth = session(UserRole.PATIENT, 'patient-test-user');
      await request(app.getHttpServer())
        .patch(`/appointments/me/${id}/cancel`)
        .set('Authorization', auth)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/appointments/me/${id}/reschedule`)
        .set('Authorization', auth)
        .send({ appointmentDate: '2999-01-01', startTime: '09:00' })
        .expect(400);
      expect(appointment.update).not.toHaveBeenCalled();
    },
  );
});
