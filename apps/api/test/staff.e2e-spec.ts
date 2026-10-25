import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { UserRole } from '../generated/prisma/enums';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { StaffController } from '../src/modules/staff/staff.controller';
import {
  STAFF_PAGE_SIZE,
  StaffService,
} from '../src/modules/staff/staff.service';

const adminId = `c${'4'.repeat(24)}`;
const createdId = `c${'8'.repeat(24)}`;
const fixedDate = new Date('2026-10-22T12:00:00Z');
// Synthetic test value, not a real credential.
const syntheticPassword = 'clave-sintetica-123';

const validBody = {
  email: '  Nueva.Psicologa@Example.Invalid ',
  password: syntheticPassword,
  fullName: '  Psicóloga Sintética ',
  role: UserRole.PSYCHOLOGIST,
};

function createdRow(role: UserRole = UserRole.PSYCHOLOGIST) {
  return {
    id: createdId,
    email: 'nueva.psicologa@example.invalid',
    role,
    isActive: true,
    createdAt: fixedDate,
    staffProfile: {
      fullName: 'Psicóloga Sintética',
      phone: null,
      position: role === UserRole.PSYCHOLOGIST ? 'Psicólogo' : null,
    },
  };
}

describe('Internal users (POST/GET /staff, isolated Prisma; real JWT/roles/validation)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const database = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    staffProfile: { findMany: jest.fn() },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('hex') }),
      ],
      controllers: [StaffController],
      providers: [
        StaffService,
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
    database.user.findFirst.mockResolvedValue({ id: adminId });
    database.user.findUnique.mockResolvedValue(null);
    database.user.create.mockResolvedValue(createdRow());
    database.user.findMany.mockResolvedValue([createdRow()]);
  });

  afterAll(async () => {
    await app.close();
  });

  function session(role: UserRole, sub = adminId) {
    return `Bearer ${jwt.sign({ sub, role, email: 'synthetic@example.invalid' })}`;
  }

  function create(body: object, role: UserRole = UserRole.ADMIN) {
    return request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', session(role))
      .send(body);
  }

  function list(query = '', role: UserRole = UserRole.ADMIN) {
    return request(app.getHttpServer())
      .get(`/staff${query}`)
      .set('Authorization', session(role));
  }

  describe('access control', () => {
    it('rejects requests without a token before touching Prisma', async () => {
      await request(app.getHttpServer())
        .post('/staff')
        .send(validBody)
        .expect(401);
      await request(app.getHttpServer()).get('/staff').expect(401);
      expect(database.user.findFirst).not.toHaveBeenCalled();
    });

    it.each([UserRole.PATIENT, UserRole.STAFF, UserRole.PSYCHOLOGIST])(
      '%s cannot create or list internal users',
      async (role) => {
        await create(validBody, role).expect(403);
        await list('', role).expect(403);
        expect(database.user.create).not.toHaveBeenCalled();
        expect(database.user.findMany).not.toHaveBeenCalled();
      },
    );

    it('an ADMIN deactivated after login gets 403 and nothing is created', async () => {
      database.user.findFirst.mockResolvedValue(null);
      await create(validBody).expect(403);
      await list().expect(403);
      expect(database.user.create).not.toHaveBeenCalled();
      expect(database.user.findMany).not.toHaveBeenCalled();
      expect(database.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: adminId, role: UserRole.ADMIN, isActive: true },
        }),
      );
    });
  });

  describe('POST /staff', () => {
    it('creates a psychologist with a hashed password and returns no secrets', async () => {
      const response = await create(validBody).expect(201);

      expect(response.body).toEqual({
        id: createdId,
        email: 'nueva.psicologa@example.invalid',
        role: UserRole.PSYCHOLOGIST,
        isActive: true,
        createdAt: fixedDate.toISOString(),
        fullName: 'Psicóloga Sintética',
        phone: null,
        position: 'Psicólogo',
      });
      expect(JSON.stringify(response.body)).not.toContain('password');

      const [args] = database.user.create.mock.calls[0] as [
        {
          data: {
            email: string;
            passwordHash: string;
            role: UserRole;
            staffProfile: { create: Record<string, unknown> };
          };
          select: Record<string, unknown>;
        },
      ];
      expect(args.data.email).toBe('nueva.psicologa@example.invalid');
      expect(args.data.role).toBe(UserRole.PSYCHOLOGIST);
      expect(args.data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(args.data.passwordHash).not.toContain(syntheticPassword);
      expect(args.data.staffProfile.create).toEqual({
        fullName: 'Psicóloga Sintética',
        phone: null,
        position: 'Psicólogo',
      });
      expect(args.select).not.toHaveProperty('passwordHash');
    });

    it('creates a STAFF user without a default position', async () => {
      database.user.create.mockResolvedValue(createdRow(UserRole.STAFF));
      await create({
        ...validBody,
        role: UserRole.STAFF,
        phone: ' 3001234567 ',
      }).expect(201);
      const [args] = database.user.create.mock.calls[0] as [
        { data: { role: UserRole; staffProfile: { create: object } } },
      ];
      expect(args.data.role).toBe(UserRole.STAFF);
      expect(args.data.staffProfile.create).toEqual({
        fullName: 'Psicóloga Sintética',
        phone: '3001234567',
        position: null,
      });
    });

    it.each([UserRole.ADMIN, UserRole.PATIENT, 'ROOT'])(
      'rejects role %s (no privilege escalation)',
      async (role) => {
        await create({ ...validBody, role }).expect(400);
        expect(database.user.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['isActive', false],
      ['passwordHash', 'x'],
      ['id', createdId],
    ])('rejects the extra field %s', async (field, value) => {
      await create({ ...validBody, [field]: value }).expect(400);
      expect(database.user.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a name made of spaces', { fullName: '     ' }],
      ['a short password', { password: 'corta' }],
      ['an invalid email', { email: 'no-es-correo' }],
      ['a short phone', { phone: '123' }],
    ])('rejects %s', async (_label, patch) => {
      await create({ ...validBody, ...patch }).expect(400);
      expect(database.user.create).not.toHaveBeenCalled();
    });

    it('returns 409 when the email already exists', async () => {
      database.user.findUnique.mockResolvedValue({ id: createdId });
      const response = await create(validBody).expect(409);
      expect((response.body as { message: string }).message).toBe(
        'Ya existe un usuario registrado con este correo electrónico.',
      );
      expect(database.user.create).not.toHaveBeenCalled();
    });

    it('returns 409 (not 500) when a concurrent request takes the email first', async () => {
      database.user.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await create(validBody).expect(409);
    });
  });

  describe('GET /staff', () => {
    it('lists only psychologists and staff, newest first, without secrets', async () => {
      const response = await list().expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        items: [
          expect.objectContaining({
            id: createdId,
            fullName: 'Psicóloga Sintética',
          }),
        ],
        page: 1,
        pageSize: STAFF_PAGE_SIZE,
        hasMore: false,
      });
      expect(JSON.stringify(response.body)).not.toContain('password');

      const [args] = database.user.findMany.mock.calls[0] as [
        {
          where: unknown;
          orderBy: unknown;
          skip: number;
          take: number;
          select: Record<string, unknown>;
        },
      ];
      expect(args.where).toEqual({
        role: { in: [UserRole.PSYCHOLOGIST, UserRole.STAFF] },
      });
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      expect(args.skip).toBe(0);
      expect(args.take).toBe(STAFF_PAGE_SIZE + 1);
      expect(args.select).not.toHaveProperty('passwordHash');
    });

    it('paginates with hasMore', async () => {
      database.user.findMany.mockResolvedValue(
        Array.from({ length: STAFF_PAGE_SIZE + 1 }, () => createdRow()),
      );
      const response = await list('?page=2').expect(200);
      const body = response.body as { items: unknown[]; hasMore: boolean };
      expect(body.items).toHaveLength(STAFF_PAGE_SIZE);
      expect(body.hasMore).toBe(true);
      const [args] = database.user.findMany.mock.calls[0] as [{ skip: number }];
      expect(args.skip).toBe(STAFF_PAGE_SIZE);
    });

    it.each(['0', '-1', 'abc', '10001'])('rejects page=%s', async (page) => {
      await list(`?page=${page}`).expect(400);
      expect(database.user.findMany).not.toHaveBeenCalled();
    });
  });
});
