import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';

// Sign-up never opens without a published policy, and the evidence is built only
// from the server-side document (no database: Prisma is mocked).
describe('Patient sign-up and the data-processing policy (no real database)', () => {
  let app: INestApplication<App>;
  const policy = {
    id: 'policy-1',
    version: '2026-11',
    title: 'Política sintética',
    body: 'Texto sintético.',
    sha256: 'b'.repeat(64),
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const database = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((args: unknown) => Promise.resolve({ id: 'u1', args })),
    },
    legalDocument: { findFirst: jest.fn() },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation(database),
    ),
  };
  const body = {
    email: 'nuevo@example.invalid',
    password: 'contraseña-sintética-1',
    acceptDataPolicy: true,
    dataPolicyVersion: policy.version,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [UsersService, { provide: PrismaService, useValue: database }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    database.legalDocument.findFirst.mockResolvedValue(policy);
  });

  afterAll(async () => {
    await app.close();
  });

  it('without a published policy, sign-up is closed (503) and nothing is written', async () => {
    database.legalDocument.findFirst.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).post('/users').send(body).expect(503);
    expect(response.body.message).toMatch(/aún no está publicada/);
    expect(database.user.create).not.toHaveBeenCalled();
  });

  it('records the published version and hash; the date is left to the database', async () => {
    await request(app.getHttpServer()).post('/users').send(body).expect(201);
    expect(database.user.create).toHaveBeenCalledTimes(1);
    const [{ data }] = database.user.create.mock.calls[0] as unknown as [
      { data: { dataConsents: { create: Record<string, unknown> } } },
    ];
    expect(data.dataConsents.create).toEqual({
      documentId: policy.id,
      purpose: 'ACCOUNT_DATA_PROCESSING',
      source: 'PATIENT_REGISTRATION',
      documentVersion: policy.version,
      documentSha256: policy.sha256,
    });
  });

  it('an outdated version is refused before any password hashing or write', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .send({ ...body, dataPolicyVersion: '2025-01' })
      .expect(400);
    expect(response.body.message).toMatch(/no es la vigente/);
    expect(database.user.create).not.toHaveBeenCalled();
  });
});
