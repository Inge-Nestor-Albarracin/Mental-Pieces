import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { JwtAuthGuard } from '../src/modules/auth/auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  LOCKED_MESSAGE,
  LoginAttemptsService,
} from '../src/modules/auth/login-attempts.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { RATE_LIMITS } from '../src/security/rate-limits';

jest.setTimeout(60_000);

// Wrap the real bcrypt.compare so calls can be observed.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return {
    ...actual,
    compare: jest.fn((password: string, hash: string) =>
      actual.compare(password, hash),
    ),
  };
});

const PASSWORD = 'contraseña-sintética-1';
// Cost 4 keeps the test fast; production uses 12.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const account = {
  id: `c${'1'.repeat(24)}`,
  email: 'paciente@example.invalid',
  passwordHash: PASSWORD_HASH,
  role: 'PATIENT',
  isActive: true,
};

describe('Authentication hardening (no real database)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let secret: string;
  // A published (synthetic) policy so sign-ups can accept it.
  const policy = {
    id: 'policy-1',
    version: '2026-test',
    title: 'Política sintética',
    body: 'Texto sintético.',
    sha256: 'a'.repeat(64),
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const database = {
    user: {
      findUnique: jest.fn((args: { where: { email: string } }) =>
        Promise.resolve(args.where.email === account.email ? account : null),
      ),
      create: jest.fn(),
    },
    legalDocument: { findFirst: jest.fn(() => Promise.resolve(policy)) },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation(database),
    ),
  };

  async function boot() {
    secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret,
          signOptions: { expiresIn: '15m', algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        }),
        ThrottlerModule.forRoot([{ name: 'default', ...RATE_LIMITS.default }]),
      ],
      controllers: [AuthController, UsersController],
      providers: [
        AuthService,
        LoginAttemptsService,
        UsersService,
        JwtAuthGuard,
        { provide: PrismaService, useValue: database },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
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
  }

  // Fresh app (and fresh in-memory limits) for every test.
  beforeEach(async () => {
    jest.clearAllMocks();
    await boot();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  it('valid credentials still work', async () => {
    const response = await login(account.email, PASSWORD).expect(201);
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('user.passwordHash');
  });

  it('locks an account after 5 failures, even for the correct password', async () => {
    for (let i = 0; i < 5; i++) {
      await login(account.email, 'contraseña-incorrecta').expect(401);
    }
    const locked = await login(account.email, PASSWORD).expect(429);
    expect(locked.body).toHaveProperty('message', LOCKED_MESSAGE);
  });

  it('an unknown email behaves exactly like a real one (no enumeration)', async () => {
    const unknown = 'nadie@example.invalid';
    const realFailure = await login(
      account.email,
      'contraseña-incorrecta',
    ).expect(401);
    const unknownFailure = await login(unknown, 'contraseña-incorrecta').expect(
      401,
    );
    expect(unknownFailure.body).toEqual(realFailure.body);
    for (let i = 0; i < 4; i++) {
      await login(unknown, 'contraseña-incorrecta').expect(401);
    }
    await login(unknown, 'contraseña-incorrecta').expect(429);
  });

  it('runs a bcrypt comparison even when the account does not exist', async () => {
    const compare = bcrypt.compare as unknown as jest.Mock<
      Promise<boolean>,
      [string, string]
    >;
    compare.mockClear();
    await login('nadie@example.invalid', 'contraseña-incorrecta').expect(401);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]?.[1]).toMatch(/^\$2[aby]\$12\$/);
  });

  it('a successful login clears previous failures', async () => {
    for (let i = 0; i < 4; i++) {
      await login(account.email, 'contraseña-incorrecta').expect(401);
    }
    await login(account.email, PASSWORD).expect(201);
    await login(account.email, 'contraseña-incorrecta').expect(401);
    await login(account.email, PASSWORD).expect(201);
  });

  it(`limits login attempts per IP (${RATE_LIMITS.login.limit} per window)`, async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      // Different emails: this is the IP limit, not the account lock.
      await login(`u${i}@example.invalid`, 'contraseña-incorrecta').expect(401);
    }
    await login('otro@example.invalid', 'contraseña-incorrecta').expect(429);
  });

  it(`limits registrations per IP (${RATE_LIMITS.register.limit} per hour)`, async () => {
    database.user.create.mockResolvedValue({ id: 'x' });
    for (let i = 0; i < RATE_LIMITS.register.limit; i++) {
      await request(app.getHttpServer())
        .post('/users')
        .send({
          email: `nuevo${i}@example.invalid`,
          password: PASSWORD,
          acceptDataPolicy: true,
          dataPolicyVersion: policy.version,
        })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/users')
      .send({
        email: 'otro@example.invalid',
        password: PASSWORD,
        acceptDataPolicy: true,
        dataPolicyVersion: policy.version,
      })
      .expect(429);
  });

  it('rejects tokens signed with another algorithm', async () => {
    const forged = jwt.sign(
      { sub: account.id, email: account.email, role: 'ADMIN' },
      { secret, algorithm: 'HS512' },
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    const valid = jwt.sign({
      sub: account.id,
      email: account.email,
      role: 'PATIENT',
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${valid}`)
      .expect(200);
  });

  it('rejects unsigned ("alg: none") tokens', async () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: account.id, role: 'ADMIN' })}.`;
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${unsigned}`)
      .expect(401);
  });
});

describe('LoginAttemptsService memory bound', () => {
  class TestAttempts extends LoginAttemptsService {
    clock = 0;
    protected now() {
      return this.clock;
    }
    size() {
      return (this as unknown as { attempts: Map<string, unknown> }).attempts
        .size;
    }
  }

  it('never tracks more than 10 000 accounts', () => {
    const attempts = new TestAttempts();
    for (let i = 0; i < 10_050; i++)
      attempts.recordFailure(`x${i}@example.invalid`);
    expect(attempts.size()).toBeLessThanOrEqual(10_000);
  });

  it('a lock expires after 15 minutes', () => {
    const attempts = new TestAttempts();
    for (let i = 0; i < 5; i++) attempts.recordFailure('a@example.invalid');
    expect(() => attempts.assertNotLocked('a@example.invalid')).toThrow(
      LOCKED_MESSAGE,
    );
    attempts.clock += 15 * 60_000 + 1;
    expect(() => attempts.assertNotLocked('a@example.invalid')).not.toThrow();
  });
});
