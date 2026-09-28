import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { ClinicalController } from '../src/modules/clinical/clinical.controller';
import { ClinicalService } from '../src/modules/clinical/clinical.service';
import { ClinicalAccessService } from '../src/modules/clinical/clinical-access.service';
import { ClinicalTransactionService } from '../src/modules/clinical/clinical-transaction.service';
import { CareRelationshipsController } from '../src/modules/clinical/care-relationships.controller';
import { CareRelationshipsService } from '../src/modules/clinical/care-relationships.service';

const patientId = `c${'1'.repeat(24)}`;
const psychologistId = `c${'2'.repeat(24)}`;
const otherPsychologistId = `c${'3'.repeat(24)}`;
const adminId = `c${'4'.repeat(24)}`;
const relationshipId = `c${'5'.repeat(24)}`;
const noteId = `c${'6'.repeat(24)}`;
const appointmentId = `c${'7'.repeat(24)}`;
const notesPath = `/clinical/patients/${patientId}/notes`;
const fixedDate = new Date('2026-09-28T12:00:00Z');
const note = {
  id: noteId,
  content: 'Texto sintético de prueba.',
  appointmentId: null,
  createdAt: fixedDate,
  updatedAt: fixedDate,
};
const relationship = {
  id: relationshipId,
  patientId,
  psychologistId,
  isActive: true,
  assignedAt: fixedDate,
  endedAt: null,
};

describe('Clinical HTTP authorization (isolated Prisma; real JWT/roles/validation)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const tx = {
    user: { findFirst: jest.fn() },
    patient: { findFirst: jest.fn() },
    careRelationship: {
      findFirst: jest.fn(),
      findMany: jest.fn<
        Promise<unknown[]>,
        [Prisma.CareRelationshipFindManyArgs]
      >(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    clinicalSessionNote: {
      findMany: jest.fn<
        Promise<unknown[]>,
        [Prisma.ClinicalSessionNoteFindManyArgs]
      >(),
      create: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    appointment: {
      findFirst: jest.fn<Promise<unknown>, [Prisma.AppointmentFindFirstArgs]>(),
    },
  };
  const database = {
    $transaction: jest.fn(
      (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(tx as unknown as Prisma.TransactionClient),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('hex') }),
      ],
      controllers: [ClinicalController, CareRelationshipsController],
      providers: [
        ClinicalService,
        CareRelationshipsService,
        ClinicalAccessService,
        ClinicalTransactionService,
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
    tx.user.findFirst.mockImplementation((query: { where: { id: string } }) =>
      Promise.resolve({ id: query.where.id }),
    );
    tx.patient.findFirst.mockResolvedValue({ id: patientId });
    tx.careRelationship.findFirst.mockResolvedValue({ id: relationshipId });
    tx.careRelationship.findMany.mockResolvedValue([
      { patient: { id: patientId, fullName: 'Nombre sintético' } },
    ]);
    tx.careRelationship.findUnique.mockResolvedValue(relationship);
    tx.careRelationship.create.mockResolvedValue(relationship);
    tx.careRelationship.update.mockResolvedValue({
      ...relationship,
      isActive: false,
      endedAt: fixedDate,
    });
    tx.clinicalSessionNote.findMany.mockResolvedValue([note]);
    tx.clinicalSessionNote.create.mockResolvedValue(note);
    tx.auditLog.create.mockResolvedValue({ id: 'audit-test' });
    tx.appointment.findFirst.mockResolvedValue({
      id: appointmentId,
      status: 'COMPLETED',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function session(role: UserRole, sub = psychologistId) {
    return `Bearer ${jwt.sign({ sub, role, email: 'synthetic@example.invalid' })}`;
  }

  it('rejects missing and invalid tokens before accessing Prisma', async () => {
    await request(app.getHttpServer()).get(notesPath).expect(401);
    await request(app.getHttpServer())
      .get(notesPath)
      .set('Authorization', 'Bearer invalid-test-value')
      .expect(401);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([UserRole.PATIENT, UserRole.STAFF, UserRole.ADMIN])(
    '%s cannot list patients, read or create notes',
    async (role) => {
      const auth = session(role);
      await request(app.getHttpServer())
        .get('/clinical/patients')
        .set('Authorization', auth)
        .expect(403);
      await request(app.getHttpServer())
        .get(notesPath)
        .set('Authorization', auth)
        .expect(403);
      await request(app.getHttpServer())
        .post(notesPath)
        .set('Authorization', auth)
        .send({ content: note.content })
        .expect(403);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('assigned A reads only A notes, with no-store and minimal fields', async () => {
    const response = await request(app.getHttpServer())
      .get(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({
      items: [
        {
          ...note,
          createdAt: fixedDate.toISOString(),
          updatedAt: fixedDate.toISOString(),
        },
      ],
      page: 1,
      pageSize: 20,
      hasMore: false,
    });
    expect(tx.careRelationship.findFirst).toHaveBeenCalledWith({
      where: {
        patientId,
        psychologistId,
        isActive: true,
        endedAt: null,
        psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
        patient: { user: { role: UserRole.PATIENT, isActive: true } },
      },
      select: { id: true },
    });
    expect(tx.clinicalSessionNote.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        patientId,
        psychologistId,
        careRelationship: {
          isActive: true,
          psychologistId,
        },
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        appointmentId: true,
      },
    });
  });

  it.each([
    'unassigned',
    'ended relationship',
    'inactive account',
    'unknown patient',
  ])('%s returns indistinguishable 404 on read and create', async () => {
    tx.careRelationship.findFirst.mockResolvedValue(null);
    const auth = session(UserRole.PSYCHOLOGIST, otherPsychologistId);
    const read = await request(app.getHttpServer())
      .get(notesPath)
      .set('Authorization', auth)
      .expect(404);
    const create = await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', auth)
      .send({ content: note.content })
      .expect(404);
    expect(read.body).toEqual(create.body);
    expect(read.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Recurso clínico no encontrado.',
    });
    expect(tx.clinicalSessionNote.findMany).not.toHaveBeenCalled();
    expect(tx.clinicalSessionNote.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('even when B is assigned, the notes query is scoped to B as author', async () => {
    tx.clinicalSessionNote.findMany.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST, otherPsychologistId))
      .expect(200);
    expect(tx.clinicalSessionNote.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        psychologistId: otherPsychologistId,
        patientId,
      },
    });
  });

  it('lists only active assigned patients and selects no profile or note content', async () => {
    const response = await request(app.getHttpServer())
      .get('/clinical/patients')
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .expect(200);
    expect(response.body).toEqual({
      items: [{ id: patientId, fullName: 'Nombre sintético' }],
      page: 1,
      pageSize: 20,
      hasMore: false,
    });
    expect(tx.careRelationship.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        psychologistId,
        isActive: true,
        endedAt: null,
      },
      select: { patient: { select: { id: true, fullName: true } } },
      take: 21,
    });
  });

  it('creates trimmed content with identity from JWT and metadata-only audit', async () => {
    await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({ content: `  ${note.content}  ` })
      .expect(201);
    expect(tx.clinicalSessionNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { patientId, psychologistId, content: note.content },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: psychologistId,
        action: 'CLINICAL_NOTE_CREATED',
        resourceType: 'ClinicalSessionNote',
        resourceId: noteId,
      },
      select: { id: true },
    });
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each(['', '   ', '\n\t', 123, null, 'x'.repeat(10001)])(
    'rejects invalid content without querying Prisma (case %#)',
    async (content) => {
      await request(app.getHttpServer())
        .post(notesPath)
        .set('Authorization', session(UserRole.PSYCHOLOGIST))
        .send({ content })
        .expect(400);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects missing content', async () => {
    await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({})
      .expect(400);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each(['psychologistId', 'authorId', 'patientId', 'role'])(
    'rejects forbidden body field %s',
    async (field) => {
      await request(app.getHttpServer())
        .post(notesPath)
        .set('Authorization', session(UserRole.PSYCHOLOGIST))
        .send({ content: note.content, [field]: 'untrusted' })
        .expect(400);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('links a completed appointment belonging to the same patient and author', async () => {
    tx.clinicalSessionNote.create.mockResolvedValue({ ...note, appointmentId });
    const response = await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({ content: note.content, appointmentId })
      .expect(201);
    expect(response.body).toHaveProperty('appointmentId', appointmentId);
    expect(tx.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: appointmentId, patientId, psychologistId },
      select: { id: true, status: true },
    });
    expect(tx.clinicalSessionNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          patientId,
          psychologistId,
          content: note.content,
          appointmentId,
        },
      }),
    );
    expect(
      tx.careRelationship.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.appointment.findFirst.mock.invocationCallOrder[0]);
  });

  it.each([
    'another patient',
    'another psychologist',
    'nonexistent appointment',
  ])('does not link an appointment of %s', async () => {
    tx.appointment.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({ content: note.content, appointmentId })
      .expect(404);
    expect(tx.clinicalSessionNote.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'CANCELLED', 'NO_SHOW'])(
    'does not link an appointment in %s state',
    async (status) => {
      tx.appointment.findFirst.mockResolvedValue({ id: appointmentId, status });
      await request(app.getHttpServer())
        .post(notesPath)
        .set('Authorization', session(UserRole.PSYCHOLOGIST))
        .send({ content: note.content, appointmentId })
        .expect(400);
      expect(tx.clinicalSessionNote.create).not.toHaveBeenCalled();
    },
  );

  it('a valid completed appointment cannot bypass the care relationship', async () => {
    tx.careRelationship.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({ content: note.content, appointmentId })
      .expect(404);
    expect(tx.appointment.findFirst).not.toHaveBeenCalled();
    expect(tx.clinicalSessionNote.create).not.toHaveBeenCalled();
  });

  it('returns a specific 409 if another note already links the appointment', async () => {
    tx.clinicalSessionNote.create.mockRejectedValue(
      new PrismaClientKnownRequestError('synthetic duplicate', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );
    const response = await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({ content: note.content, appointmentId })
      .expect(409);
    expect(response.body).toHaveProperty(
      'message',
      'Ya existe una nota clínica principal para esta cita.',
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([null, '', 123, 'bad-id'])(
    'rejects malformed appointmentId (case %#)',
    async (invalid) => {
      await request(app.getHttpServer())
        .post(notesPath)
        .set('Authorization', session(UserRole.PSYCHOLOGIST))
        .send({ content: note.content, appointmentId: invalid })
        .expect(400);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('keeps unlinked notes valid and does not query appointments for them', async () => {
    await request(app.getHttpServer())
      .post(notesPath)
      .set('Authorization', session(UserRole.PSYCHOLOGIST))
      .send({ content: note.content })
      .expect(201);
    expect(tx.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('has no note edit or delete endpoints, including for a different author', async () => {
    const auth = session(UserRole.PSYCHOLOGIST, otherPsychologistId);
    await request(app.getHttpServer())
      .patch(`/clinical/notes/${noteId}`)
      .set('Authorization', auth)
      .send({ content: 'Otro texto sintético' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/clinical/notes/${noteId}`)
      .set('Authorization', auth)
      .expect(404);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([UserRole.PATIENT, UserRole.STAFF, UserRole.PSYCHOLOGIST])(
    '%s cannot create or end assignments',
    async (role) => {
      const auth = session(role);
      await request(app.getHttpServer())
        .post('/clinical/assignments')
        .set('Authorization', auth)
        .send({ patientId, psychologistId })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/clinical/assignments/${relationshipId}/end`)
        .set('Authorization', auth)
        .send({})
        .expect(403);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('active ADMIN creates an assignment and audits it without querying notes', async () => {
    await request(app.getHttpServer())
      .post('/clinical/assignments')
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({ patientId, psychologistId })
      .expect(201);
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: adminId, role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    expect(tx.careRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { patientId, psychologistId } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: adminId,
        action: 'CARE_RELATIONSHIP_CREATED',
        resourceType: 'CareRelationship',
        resourceId: relationshipId,
      },
      select: { id: true },
    });
    expect(tx.clinicalSessionNote.findMany).not.toHaveBeenCalled();
  });

  it('rejects an inactive ADMIN despite a previously signed ADMIN token', async () => {
    tx.user.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/clinical/assignments')
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({ patientId, psychologistId })
      .expect(403);
    expect(tx.careRelationship.create).not.toHaveBeenCalled();
  });

  it('rejects assignment to an unknown/inactive patient', async () => {
    tx.patient.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/clinical/assignments')
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({ patientId, psychologistId })
      .expect(404);
    expect(tx.careRelationship.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive/non-psychologist assignment target', async () => {
    tx.user.findFirst
      .mockResolvedValueOnce({ id: adminId })
      .mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post('/clinical/assignments')
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({ patientId, psychologistId })
      .expect(404);
    expect(tx.careRelationship.create).not.toHaveBeenCalled();
  });

  it('returns 409 on duplicate pair instead of reactivating a relationship', async () => {
    tx.careRelationship.create.mockRejectedValue(
      new PrismaClientKnownRequestError('synthetic duplicate', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );
    await request(app.getHttpServer())
      .post('/clinical/assignments')
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({ patientId, psychologistId })
      .expect(409);
    expect(tx.careRelationship.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('ADMIN ends one relationship without modifying any notes', async () => {
    await request(app.getHttpServer())
      .patch(`/clinical/assignments/${relationshipId}/end`)
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({})
      .expect(200);
    expect(tx.careRelationship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: relationshipId },
        data: { isActive: false, endedAt: expect.any(Date) as unknown },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          actorUserId: adminId,
          action: 'CARE_RELATIONSHIP_ENDED',
          resourceType: 'CareRelationship',
          resourceId: relationshipId,
        },
      }),
    );
    expect(tx.clinicalSessionNote.create).not.toHaveBeenCalled();
  });

  it('returns 409 when ending an already ended relationship', async () => {
    tx.careRelationship.findUnique.mockResolvedValue({
      ...relationship,
      isActive: false,
    });
    await request(app.getHttpServer())
      .patch(`/clinical/assignments/${relationshipId}/end`)
      .set('Authorization', session(UserRole.ADMIN, adminId))
      .send({})
      .expect(409);
    expect(tx.careRelationship.update).not.toHaveBeenCalled();
  });

  it('rejects extra fields in assignment and end bodies', async () => {
    const auth = session(UserRole.ADMIN, adminId);
    await request(app.getHttpServer())
      .post('/clinical/assignments')
      .set('Authorization', auth)
      .send({ patientId, psychologistId, isActive: true })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/clinical/assignments/${relationshipId}/end`)
      .set('Authorization', auth)
      .send({ patientId })
      .expect(400);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('validates pagination and does not accept identity filters', async () => {
    const auth = session(UserRole.PSYCHOLOGIST);
    await request(app.getHttpServer())
      .get(`${notesPath}?page=0`)
      .set('Authorization', auth)
      .expect(400);
    await request(app.getHttpServer())
      .get(`${notesPath}?psychologistId=${otherPsychologistId}`)
      .set('Authorization', auth)
      .expect(400);
    await request(app.getHttpServer())
      .get(`${notesPath}?page=2`)
      .set('Authorization', auth)
      .expect(200);
    expect(tx.clinicalSessionNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 21 }),
    );
  });

  it('sanitizes database failures so note content is not returned or logged', async () => {
    tx.clinicalSessionNote.create.mockRejectedValue(new Error(note.content));
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const response = await request(app.getHttpServer())
        .post(notesPath)
        .set('Authorization', session(UserRole.PSYCHOLOGIST))
        .send({ content: note.content })
        .expect(500);
      expect(response.body).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'No fue posible completar la operación clínica.',
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
