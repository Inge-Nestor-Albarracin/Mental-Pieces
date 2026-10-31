import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole } from '../generated/prisma/enums';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { StaffDeskController } from '../src/modules/appointments/staff-desk.controller';
import { StaffDeskService } from '../src/modules/appointments/staff-desk.service';
import { PushController } from '../src/modules/push/push.controller';
import { PushDispatcher } from '../src/modules/push/push-dispatcher';
import { PushService } from '../src/modules/push/push.service';

// Reception portal and push subscriptions: roles, validation and the SSRF guard.
// No real database (fakes) and no real push service (fake sender).

const staffId = `c${'5'.repeat(24)}`;
const patientUserId = `c${'6'.repeat(24)}`;
const patientId = `c${'1'.repeat(24)}`;
const psychologistId = `c${'2'.repeat(24)}`;
const FCM = 'https://fcm.googleapis.com/fcm/send/synthetic-endpoint';
const P256DH = `B${'x'.repeat(86)}`;
const AUTH = 'y'.repeat(22);

describe('Staff desk and push subscriptions (no real database)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const sender = { send: jest.fn().mockResolvedValue(undefined) };
  const dispatcher = {
    enabled: true,
    config: { publicKey: `B${'A'.repeat(86)}` },
    kick: jest.fn(),
    getSender: () => sender,
  };
  const appointmentsService = { createForPatient: jest.fn() };
  const pushSubscription = {
    upsert: jest.fn().mockResolvedValue({ id: 's1' }),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const database = {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    patient: { findMany: jest.fn() },
    legalDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    dataProcessingConsent: { findFirst: jest.fn() },
    pushSubscription,
    $transaction: jest.fn((operation: (tx: unknown) => Promise<unknown>) =>
      operation({ pushSubscription }),
    ),
  };

  const bearer = (sub: string, role: UserRole) =>
    `Bearer ${jwt.sign({ sub, role, email: 'synthetic@example.invalid' })}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('hex') }),
      ],
      controllers: [StaffDeskController, PushController],
      providers: [
        StaffDeskService,
        PushService,
        JwtAuthGuard,
        RolesGuard,
        { provide: PrismaService, useValue: database },
        { provide: PushDispatcher, useValue: dispatcher },
        { provide: AppointmentsService, useValue: appointmentsService },
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
    database.user.findUnique.mockResolvedValue({
      role: UserRole.STAFF,
      isActive: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('staff desk', () => {
    it.each([UserRole.PATIENT, UserRole.PSYCHOLOGIST, UserRole.ADMIN])(
      'forbids %s',
      async (role) => {
        await request(app.getHttpServer())
          .get('/staff-desk/agenda')
          .set('Authorization', bearer(staffId, role))
          .expect(403);
        await request(app.getHttpServer())
          .post('/staff-desk/appointments')
          .set('Authorization', bearer(staffId, role))
          .send({
            patientId,
            psychologistId,
            appointmentDate: '2026-11-05',
            startTime: '10:00',
          })
          .expect(403);
      },
    );

    it('requires a token', async () => {
      await request(app.getHttpServer()).get('/staff-desk/agenda').expect(401);
    });

    it('re-checks in the database that the account is still active staff', async () => {
      database.user.findUnique.mockResolvedValue({
        role: UserRole.STAFF,
        isActive: false,
      });
      await request(app.getHttpServer())
        .get('/staff-desk/patients?search=ana')
        .set('Authorization', bearer(staffId, UserRole.STAFF))
        .expect(403);
      expect(database.patient.findMany).not.toHaveBeenCalled();
    });

    it('validates the search term', async () => {
      await request(app.getHttpServer())
        .get('/staff-desk/patients?search=a')
        .set('Authorization', bearer(staffId, UserRole.STAFF))
        .expect(400);
    });

    it('returns administrative data and what blocks booking', async () => {
      database.patient.findMany.mockResolvedValue([
        {
          id: patientId,
          userId: patientUserId,
          mrn: 'MP-0001',
          fullName: 'Paciente Sintética',
          birthDate: new Date('1990-01-01T00:00:00Z'),
          gender: 'FEMALE',
          genderOther: null,
          phone: '300 000 0000',
          user: { email: 'paciente@example.invalid' },
        },
      ]);
      const response = await request(app.getHttpServer())
        .get('/staff-desk/patients?search=sint')
        .set('Authorization', bearer(staffId, UserRole.STAFF))
        .expect(200);
      expect(response.body).toEqual({
        hasMore: false,
        items: [
          {
            id: patientId,
            mrn: 'MP-0001',
            fullName: 'Paciente Sintética',
            email: 'paciente@example.invalid',
            phone: '300 000 0000',
            canBook: false,
            // No published policy in this fake database.
            blockers: ['DATA_POLICY'],
          },
        ],
      });
    });

    it('books through the shared booking service with the staff id', async () => {
      appointmentsService.createForPatient.mockResolvedValue({ id: 'a1' });
      const body = {
        patientId,
        psychologistId,
        appointmentDate: '2026-11-05',
        startTime: '10:00',
      };
      await request(app.getHttpServer())
        .post('/staff-desk/appointments')
        .set('Authorization', bearer(staffId, UserRole.STAFF))
        .send(body)
        .expect(201);
      expect(appointmentsService.createForPatient).toHaveBeenCalledWith(
        staffId,
        expect.objectContaining(body),
      );
    });

    it('rejects a malformed patient id', async () => {
      await request(app.getHttpServer())
        .post('/staff-desk/appointments')
        .set('Authorization', bearer(staffId, UserRole.STAFF))
        .send({
          patientId: 'x',
          psychologistId,
          appointmentDate: '2026-11-05',
          startTime: '10:00',
        })
        .expect(400);
      expect(appointmentsService.createForPatient).not.toHaveBeenCalled();
    });
  });

  describe('push subscriptions', () => {
    it.each(Object.values(UserRole))(
      '%s can read the push config',
      async (role) => {
        const response = await request(app.getHttpServer())
          .get('/push/config')
          .set('Authorization', bearer(staffId, role))
          .expect(200);
        expect(response.body).toEqual({
          enabled: true,
          publicKey: dispatcher.config.publicKey,
        });
      },
    );

    it('stores a subscription for the caller', async () => {
      await request(app.getHttpServer())
        .post('/push/subscriptions')
        .set('Authorization', bearer(staffId, UserRole.PATIENT))
        .send({ endpoint: FCM, p256dh: P256DH, auth: AUTH })
        .expect(200);
      const [args] = database.pushSubscription.upsert.mock.calls[0] as [
        { where: unknown; update: { userId: string } },
      ];
      expect(args.where).toEqual({ endpoint: FCM });
      expect(args.update.userId).toBe(staffId);
    });

    it('rejects endpoints outside the browser push services (SSRF)', async () => {
      for (const endpoint of [
        'https://127.0.0.1/internal',
        'https://api.mentalpieces.site/staff',
        'http://fcm.googleapis.com/fcm/send/x',
      ]) {
        await request(app.getHttpServer())
          .post('/push/subscriptions')
          .set('Authorization', bearer(staffId, UserRole.PATIENT))
          .send({ endpoint, p256dh: P256DH, auth: AUTH })
          .expect(400);
      }
      expect(database.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('rejects malformed keys and unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/push/subscriptions')
        .set('Authorization', bearer(staffId, UserRole.PATIENT))
        .send({ endpoint: FCM, p256dh: 'short', auth: AUTH })
        .expect(400);
      await request(app.getHttpServer())
        .post('/push/subscriptions')
        .set('Authorization', bearer(staffId, UserRole.PATIENT))
        .send({ endpoint: FCM, p256dh: P256DH, auth: AUTH, userId: 'other' })
        .expect(400);
    });

    it('only removes the caller’s own subscription', async () => {
      await request(app.getHttpServer())
        .delete('/push/subscriptions')
        .set('Authorization', bearer(staffId, UserRole.ADMIN))
        .send({ endpoint: FCM })
        .expect(200);
      expect(database.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: staffId, endpoint: FCM },
      });
    });

    it('sends the test notification only to the caller’s devices', async () => {
      database.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: FCM, p256dh: P256DH, auth: AUTH },
      ]);
      const response = await request(app.getHttpServer())
        .post('/push/test')
        .set('Authorization', bearer(staffId, UserRole.PSYCHOLOGIST))
        .expect(200);
      expect(response.body).toEqual({ devices: 1, delivered: 1 });
      expect(database.pushSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: staffId } }),
      );
      expect(sender.send).toHaveBeenCalledTimes(1);
    });
  });
});
