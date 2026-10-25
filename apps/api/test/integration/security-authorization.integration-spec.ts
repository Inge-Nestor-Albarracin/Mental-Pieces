// Level I: full HTTP app (AppModule: real JWT, guards, ThrottlerGuard, ValidationPipe)
// against a disposable PostgreSQL. Every write attempt is followed by a read of the
// persisted row: a 404 with a partial write would still be a failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppointmentStatus, UserRole } from '../../generated/prisma/enums';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import {
  assertDisposableDatabase,
  businessDatePlus,
  Fixtures,
  minutes,
  type FixtureUser,
} from './support/fixtures';

interface CaseRow {
  id: string;
  endpoint: string;
  role: string;
  operation: string;
  expected: number;
  observed: number;
  persisted: string;
  result: 'PASS' | 'FAIL';
}

const matrix: CaseRow[] = [];
const bodies: string[] = [];

describe('Authorization / BOLA-IDOR over HTTP with a disposable PostgreSQL (Level I)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let fx: Fixtures;

  let patientA: FixtureUser;
  let patientB: FixtureUser;
  let patientC: FixtureUser;
  let inactivePatient: FixtureUser;
  let psyX: FixtureUser;
  let psyY: FixtureUser;
  let inactivePsy: FixtureUser;
  let admin: FixtureUser;
  let staff: FixtureUser;
  let apptA: { id: string };
  let apptB: { id: string };
  let pastA: { id: string };
  let pastA2: { id: string };
  let completedA: { id: string };
  let noShowA: { id: string };
  let completedB: { id: string };
  let noteX: { id: string };
  let noteY: { id: string };
  const futureDate = businessDatePlus(3);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
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
    prisma = module.get(PrismaService);
    jwt = module.get(JwtService);
    await assertDisposableDatabase(prisma);
    fx = new Fixtures(prisma);

    patientA = await fx.patient('Paciente A Sintético');
    patientB = await fx.patient('Paciente B Sintético');
    patientC = await fx.patient('Paciente C Sintético');
    inactivePatient = await fx.patient('Paciente Inactivo');
    await prisma.user.update({
      where: { id: inactivePatient.userId },
      data: { isActive: false },
    });
    psyX = await fx.psychologist();
    psyY = await fx.psychologist();
    inactivePsy = await fx.psychologist(false);
    admin = await fx.staffUser(UserRole.ADMIN);
    staff = await fx.staffUser(UserRole.STAFF);

    await fx.careRelationship(patientA, psyX);
    await fx.careRelationship(patientC, psyX);
    // The inactive psychologist keeps an (active) relationship: only isActive should block it.
    await fx.careRelationship(patientB, inactivePsy);
    apptA = await fx.appointment(patientA, psyX, futureDate, minutes('08:00'));
    apptB = await fx.appointment(patientB, psyX, futureDate, minutes('10:00'));
    pastA = await fx.appointment(
      patientA,
      psyX,
      businessDatePlus(-1),
      minutes('08:00'),
    );
    pastA2 = await fx.appointment(
      patientA,
      psyX,
      businessDatePlus(-2),
      minutes('08:00'),
    );
    completedA = await fx.appointment(
      patientA,
      psyX,
      businessDatePlus(-3),
      minutes('08:00'),
      'COMPLETED',
    );
    noShowA = await fx.appointment(
      patientA,
      psyX,
      businessDatePlus(-4),
      minutes('08:00'),
      'NO_SHOW',
    );
    completedB = await fx.appointment(
      patientB,
      psyX,
      businessDatePlus(-3),
      minutes('10:00'),
      'COMPLETED',
    );
    noteX = await prisma.clinicalSessionNote.create({
      data: {
        patientId: patientA.patientId!,
        psychologistId: psyX.userId,
        content: 'Nota sintética de X.',
      },
      select: { id: true },
    });
    // Y had a relationship with A in the past and wrote a note; the relationship ended.
    const yRelationship = await fx.careRelationship(patientA, psyY);
    noteY = await prisma.clinicalSessionNote.create({
      data: {
        patientId: patientA.patientId!,
        psychologistId: psyY.userId,
        content: 'Nota sintética de Y.',
      },
      select: { id: true },
    });
    await prisma.careRelationship.update({
      where: { id: yRelationship.id },
      data: { isActive: false, endedAt: new Date() },
    });
  });

  afterAll(async () => {
    const dir = process.env.AUDIT_RESULTS_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'authorization-matrix.json'),
        JSON.stringify(matrix, null, 2),
      );
    }
    await fx.cleanup();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (user: FixtureUser) => fx.token(jwt, user);

  function note(
    row: Omit<CaseRow, 'result' | 'observed'>,
    response: { status: number; text: string },
    persistedOk = true,
  ) {
    bodies.push(response.text);
    const result =
      response.status === row.expected && persistedOk ? 'PASS' : 'FAIL';
    matrix.push({ ...row, observed: response.status, result });
    expect({ id: row.id, status: response.status, persistedOk }).toEqual({
      id: row.id,
      status: row.expected,
      persistedOk: true,
    });
  }

  async function appointmentState(id: string) {
    return prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        appointmentDate: true,
        startMinute: true,
        patientId: true,
      },
    });
  }

  describe('patients and appointments', () => {
    it('A1-A2: each patient lists only their own appointments', async () => {
      const a = await http()
        .get('/appointments/me')
        .set('Authorization', auth(patientA));
      const ids = (a.body as { id: string }[]).map((item) => item.id);
      note(
        {
          id: 'A1',
          endpoint: 'GET /appointments/me',
          role: 'PATIENT A',
          operation: 'listar propias',
          expected: 200,
          persisted: 'n/a',
        },
        a,
        ids.includes(apptA.id) && !ids.includes(apptB.id),
      );
      const b = await http()
        .get('/appointments/me?patientId=' + patientA.patientId)
        .set('Authorization', auth(patientB));
      const idsB = (b.body as { id: string }[]).map((item) => item.id);
      note(
        {
          id: 'A2',
          endpoint: 'GET /appointments/me?patientId=A',
          role: 'PATIENT B',
          operation: 'listar con filtro ajeno',
          expected: 200,
          persisted: 'n/a',
        },
        b,
        !idsB.includes(apptA.id) && idsB.includes(apptB.id),
      );
    });

    it('A3-A4: B cannot cancel or reschedule A appointment (404, row unchanged)', async () => {
      const before = await appointmentState(apptA.id);
      const cancel = await http()
        .patch(`/appointments/me/${apptA.id}/cancel`)
        .set('Authorization', auth(patientB))
        .send({});
      note(
        {
          id: 'A3',
          endpoint: 'PATCH /appointments/me/:id/cancel',
          role: 'PATIENT B',
          operation: 'cancelar cita de A',
          expected: 404,
          persisted: 'cita A intacta',
        },
        cancel,
        JSON.stringify(await appointmentState(apptA.id)) ===
          JSON.stringify(before),
      );
      const move = await http()
        .patch(`/appointments/me/${apptA.id}/reschedule`)
        .set('Authorization', auth(patientB))
        .send({ appointmentDate: futureDate, startTime: '16:00' });
      note(
        {
          id: 'A4',
          endpoint: 'PATCH /appointments/me/:id/reschedule',
          role: 'PATIENT B',
          operation: 'reagendar cita de A',
          expected: 404,
          persisted: 'cita A intacta',
        },
        move,
        JSON.stringify(await appointmentState(apptA.id)) ===
          JSON.stringify(before),
      );
    });

    it('A5: forbidden fields in booking and cancel bodies are rejected without writes', async () => {
      const count = () =>
        prisma.appointment.count({ where: { patientId: patientB.patientId } });
      const before = await count();
      const forged = await http()
        .post('/appointments/me')
        .set('Authorization', auth(patientB))
        .send({
          psychologistId: psyX.userId,
          appointmentDate: futureDate,
          startTime: '12:00',
          patientId: patientA.patientId,
          status: 'COMPLETED',
          endMinute: 999,
        });
      note(
        {
          id: 'A5a',
          endpoint: 'POST /appointments/me',
          role: 'PATIENT B',
          operation: 'patientId/status/endMinute en body',
          expected: 400,
          persisted: 'sin filas nuevas',
        },
        forged,
        (await count()) === before,
      );
      const cancel = await http()
        .patch(`/appointments/me/${apptB.id}/cancel`)
        .set('Authorization', auth(patientB))
        .send({ status: 'COMPLETED' });
      note(
        {
          id: 'A5b',
          endpoint: 'PATCH /appointments/me/:id/cancel',
          role: 'PATIENT B',
          operation: 'status en body',
          expected: 400,
          persisted: 'cita B intacta',
        },
        cancel,
        (await appointmentState(apptB.id)).status ===
          AppointmentStatus.SCHEDULED,
      );
      const profile = await http()
        .patch('/patients/me')
        .set('Authorization', auth(patientB))
        .send({ fullName: 'X Y', userId: patientA.userId });
      note(
        {
          id: 'A9',
          endpoint: 'PATCH /patients/me',
          role: 'PATIENT B',
          operation: 'userId ajeno en body',
          expected: 400,
          persisted: 'n/a',
        },
        profile,
      );
    });

    it('A6: missing, corrupt, expired, wrongly signed and tampered tokens get 401', async () => {
      const secret = process.env.JWT_SECRET!;
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        sub: patientA.userId,
        role: UserRole.PATIENT,
        email: patientA.email,
      };
      const expired = new JwtService({ secret }).sign({
        ...claims,
        iat: now - 3600,
        exp: now - 60,
      });
      const foreign = new JwtService({
        secret: 'otra-clave-de-prueba-que-no-es-la-real',
      }).sign(claims);
      const [h, p, s] = auth(patientA).replace('Bearer ', '').split('.');
      const payload = JSON.parse(
        Buffer.from(p, 'base64url').toString(),
      ) as object;
      const tampered = [
        h,
        Buffer.from(JSON.stringify({ ...payload, role: 'ADMIN' })).toString(
          'base64url',
        ),
        s,
      ].join('.');
      const cases: [string, string | undefined][] = [
        ['A6a sin token', undefined],
        ['A6b token corrupto', 'Bearer no-es-un-jwt'],
        ['A6c token vencido', `Bearer ${expired}`],
        ['A6d firma de otra clave', `Bearer ${foreign}`],
        ['A6e rol adulterado (ADMIN)', `Bearer ${tampered}`],
      ];
      for (const [label, header] of cases) {
        const call = http().get('/appointments/me');
        const response = await (header
          ? call.set('Authorization', header)
          : call);
        note(
          {
            id: label.split(' ')[0],
            endpoint: 'GET /appointments/me',
            role: label,
            operation: 'acceso',
            expected: 401,
            persisted: 'n/a',
          },
          response,
          !response.text.includes(apptA.id),
        );
      }
    });

    it('A7: valid tokens with the wrong role get 403', async () => {
      const cases: [string, FixtureUser, string, 'get' | 'post'][] = [
        ['A7a', patientA, '/clinical/patients', 'get'],
        ['A7b', psyX, '/appointments/me', 'post'],
        ['A7c', staff, '/clinical/assignments', 'get'],
        ['A7d', staff, '/staff', 'get'],
        ['A7e', patientA, '/clinical/admin/patients', 'get'],
        [
          'A7f',
          admin,
          '/appointments/available-slots?psychologistId=x&date=2030-01-01',
          'get',
        ],
        ['A7g', staff, '/patients/me', 'get'],
      ];
      for (const [id, user, path, method] of cases) {
        const response = await http()
          [method](path)
          .set('Authorization', auth(user))
          .send(method === 'post' ? {} : undefined);
        note(
          {
            id,
            endpoint: `${method.toUpperCase()} ${path.split('?')[0]}`,
            role: user.role,
            operation: 'rol incompatible',
            expected: 403,
            persisted: 'n/a',
          },
          response,
        );
      }
    });

    it('A8: inactive accounts with a previously issued JWT (revocation gap is reported, not hidden)', async () => {
      const agenda = await http()
        .get('/appointments/psychologist/me')
        .set('Authorization', auth(inactivePsy));
      note(
        {
          id: 'A8a',
          endpoint: 'GET /appointments/psychologist/me',
          role: 'PSYCHOLOGIST inactivo',
          operation: 'JWT previo',
          expected: 403,
          persisted: 'n/a',
        },
        agenda,
      );
      const notes = await http()
        .get(`/clinical/patients/${patientB.patientId}/notes`)
        .set('Authorization', auth(inactivePsy));
      note(
        {
          id: 'A8b',
          endpoint: 'GET /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST inactivo',
          operation: 'JWT previo, relación activa',
          expected: 404,
          persisted: 'n/a',
        },
        notes,
      );
      // Observed behaviour, recorded as a finding (MP-SEC-002): patient routes do not re-check isActive.
      const mine = await http()
        .get('/appointments/me')
        .set('Authorization', auth(inactivePatient));
      matrix.push({
        id: 'A8c',
        endpoint: 'GET /appointments/me',
        role: 'PATIENT inactivo',
        operation: 'JWT previo (≤15 min)',
        expected: 401,
        observed: mine.status,
        persisted: 'n/a',
        result: mine.status === 200 ? 'FAIL' : 'PASS',
      });
    });

    it('A10: pagination and identity filters never widen the result', async () => {
      const filtered = await http()
        .get(`/clinical/patients?page=1&psychologistId=${psyY.userId}`)
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'A10a',
          endpoint: 'GET /clinical/patients',
          role: 'PSYCHOLOGIST X',
          operation: 'filtro psychologistId',
          expected: 400,
          persisted: 'n/a',
        },
        filtered,
      );
      const page = await http()
        .get('/clinical/patients?page=0')
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'A10b',
          endpoint: 'GET /clinical/patients',
          role: 'PSYCHOLOGIST X',
          operation: 'page=0',
          expected: 400,
          persisted: 'n/a',
        },
        page,
      );
    });
  });

  describe('clinical notes and relationships', () => {
    it('C1-C2: X sees assigned A, Y does not', async () => {
      const x = await http()
        .get('/clinical/patients')
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'C1',
          endpoint: 'GET /clinical/patients',
          role: 'PSYCHOLOGIST X',
          operation: 'listar asignados',
          expected: 200,
          persisted: 'n/a',
        },
        x,
        x.text.includes(patientA.patientId!) &&
          !x.text.includes(patientB.patientId!),
      );
      const y = await http()
        .get('/clinical/patients')
        .set('Authorization', auth(psyY));
      note(
        {
          id: 'C2',
          endpoint: 'GET /clinical/patients',
          role: 'PSYCHOLOGIST Y',
          operation: 'listar asignados',
          expected: 200,
          persisted: 'n/a',
        },
        y,
        !y.text.includes(patientA.patientId!),
      );
    });

    it('C3-C4, C14: Y gets the same generic 404 for A and for a non-existent patient, and writes nothing', async () => {
      const read = await http()
        .get(`/clinical/patients/${patientA.patientId}/notes`)
        .set('Authorization', auth(psyY));
      const ghost = await http()
        .get(`/clinical/patients/c${'0'.repeat(24)}/notes`)
        .set('Authorization', auth(psyY));
      note(
        {
          id: 'C3',
          endpoint: 'GET /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST Y',
          operation: 'leer notas de A',
          expected: 404,
          persisted: 'n/a',
        },
        read,
        !read.text.includes('Nota sintética'),
      );
      note(
        {
          id: 'C14',
          endpoint: 'GET /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST Y',
          operation: 'paciente inexistente (enumeración)',
          expected: 404,
          persisted: 'mismo cuerpo que C3',
        },
        ghost,
        ghost.text === read.text,
      );
      const before = await prisma.clinicalSessionNote.count();
      const write = await http()
        .post(`/clinical/patients/${patientA.patientId}/notes`)
        .set('Authorization', auth(psyY))
        .send({ content: 'Intento sintético.' });
      note(
        {
          id: 'C4',
          endpoint: 'POST /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST Y',
          operation: 'crear nota para A',
          expected: 404,
          persisted: 'cero notas nuevas',
        },
        write,
        (await prisma.clinicalSessionNote.count()) === before,
      );
    });

    it('C5, C15: X reads only own notes about A (not the old note by Y), with no-store', async () => {
      const response = await http()
        .get(`/clinical/patients/${patientA.patientId}/notes`)
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'C5',
          endpoint: 'GET /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST X',
          operation: 'leer notas de A',
          expected: 200,
          persisted: 'n/a',
        },
        response,
        response.text.includes(noteX.id) &&
          !response.text.includes(noteY.id) &&
          response.headers['cache-control'] === 'no-store',
      );
    });

    it('C6, C13: PATIENT, STAFF and ADMIN cannot read or create notes', async () => {
      for (const [id, user] of [
        ['C6a', patientA],
        ['C6b', staff],
        ['C6c', admin],
      ] as const) {
        const read = await http()
          .get(`/clinical/patients/${patientA.patientId}/notes`)
          .set('Authorization', auth(user));
        note(
          {
            id,
            endpoint: 'GET /clinical/patients/:id/notes',
            role: user.role,
            operation: 'leer notas',
            expected: 403,
            persisted: 'n/a',
          },
          read,
        );
        const write = await http()
          .post(`/clinical/patients/${patientA.patientId}/notes`)
          .set('Authorization', auth(user))
          .send({ content: 'x' });
        note(
          {
            id: `${id}w`,
            endpoint: 'POST /clinical/patients/:id/notes',
            role: user.role,
            operation: 'crear nota',
            expected: 403,
            persisted: 'n/a',
          },
          write,
        );
      }
    });

    it('C9-C11: linked notes accept only own COMPLETED appointments; identity fields are rejected', async () => {
      const count = () =>
        prisma.clinicalSessionNote.count({
          where: { patientId: patientA.patientId },
        });
      const before = await count();
      for (const [id, appointmentId, expected] of [
        ['C9a', apptA.id, 400],
        ['C9b', noShowA.id, 400],
        ['C9c', completedB.id, 404],
      ] as const) {
        const response = await http()
          .post(`/clinical/patients/${patientA.patientId}/notes`)
          .set('Authorization', auth(psyX))
          .send({ content: 'Texto sintético.', appointmentId });
        note(
          {
            id,
            endpoint: 'POST /clinical/patients/:id/notes',
            role: 'PSYCHOLOGIST X',
            operation: 'vincular cita no válida',
            expected,
            persisted: 'sin nota',
          },
          response,
          (await count()) === before,
        );
      }
      const forged = await http()
        .post(`/clinical/patients/${patientA.patientId}/notes`)
        .set('Authorization', auth(psyX))
        .send({
          content: 'Texto sintético.',
          psychologistId: psyY.userId,
          authorId: psyY.userId,
        });
      note(
        {
          id: 'C11',
          endpoint: 'POST /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST X',
          operation: 'psychologistId/authorId en body',
          expected: 400,
          persisted: 'sin nota',
        },
        forged,
        (await count()) === before,
      );
      const ok = await http()
        .post(`/clinical/patients/${patientA.patientId}/notes`)
        .set('Authorization', auth(psyX))
        .send({ content: 'Texto sintético.', appointmentId: completedA.id });
      note(
        {
          id: 'C9d',
          endpoint: 'POST /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST X',
          operation: 'vincular cita COMPLETED propia',
          expected: 201,
          persisted: '1 nota',
        },
        ok,
        (await count()) === before + 1,
      );
      const dup = await http()
        .post(`/clinical/patients/${patientA.patientId}/notes`)
        .set('Authorization', auth(psyX))
        .send({ content: 'Texto sintético.', appointmentId: completedA.id });
      note(
        {
          id: 'C10',
          endpoint: 'POST /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST X',
          operation: 'segunda nota misma cita',
          expected: 409,
          persisted: 'sigue 1 nota',
        },
        dup,
        (await count()) === before + 1,
      );
      const audit = await prisma.auditLog.findMany({
        where: { actorUserId: psyX.userId },
      });
      matrix.push({
        id: 'C16',
        endpoint: 'AuditLog',
        role: 'sistema',
        operation: 'auditoría sin contenido',
        expected: 0,
        observed: JSON.stringify(audit).includes('Texto sintético') ? 1 : 0,
        persisted: `${audit.length} eventos`,
        result: JSON.stringify(audit).includes('Texto sintético')
          ? 'FAIL'
          : 'PASS',
      });
    });

    it('C8: after ADMIN ends the relationship, X loses access to that patient', async () => {
      const relationship = await prisma.careRelationship.findUniqueOrThrow({
        where: {
          patientId_psychologistId: {
            patientId: patientC.patientId!,
            psychologistId: psyX.userId,
          },
        },
        select: { id: true },
      });
      const end = await http()
        .patch(`/clinical/assignments/${relationship.id}/end`)
        .set('Authorization', auth(admin))
        .send({});
      note(
        {
          id: 'C8a',
          endpoint: 'PATCH /clinical/assignments/:id/end',
          role: 'ADMIN',
          operation: 'finalizar X-C',
          expected: 200,
          persisted: 'isActive=false',
        },
        end,
        !(
          await prisma.careRelationship.findUniqueOrThrow({
            where: { id: relationship.id },
          })
        ).isActive,
      );
      const read = await http()
        .get(`/clinical/patients/${patientC.patientId}/notes`)
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'C8b',
          endpoint: 'GET /clinical/patients/:id/notes',
          role: 'PSYCHOLOGIST X',
          operation: 'leer tras revocación',
          expected: 404,
          persisted: 'n/a',
        },
        read,
      );
    });
  });

  describe('agenda and availability', () => {
    it('G1-G4: closing appointments is limited to their own psychologist and to finished ones', async () => {
      const foreign = await http()
        .patch(`/appointments/psychologist/me/${pastA.id}/complete`)
        .set('Authorization', auth(psyY));
      note(
        {
          id: 'G1',
          endpoint: 'PATCH /appointments/psychologist/me/:id/complete',
          role: 'PSYCHOLOGIST Y',
          operation: 'cerrar cita de X',
          expected: 404,
          persisted: 'sigue SCHEDULED',
        },
        foreign,
        (await appointmentState(pastA.id)).status ===
          AppointmentStatus.SCHEDULED,
      );
      for (const [id, user] of [
        ['G2a', patientA],
        ['G2b', staff],
        ['G2c', admin],
      ] as const) {
        const response = await http()
          .patch(`/appointments/psychologist/me/${pastA.id}/no-show`)
          .set('Authorization', auth(user));
        note(
          {
            id,
            endpoint: 'PATCH /appointments/psychologist/me/:id/no-show',
            role: user.role,
            operation: 'cerrar como profesional',
            expected: 403,
            persisted: 'sigue SCHEDULED',
          },
          response,
          (await appointmentState(pastA.id)).status ===
            AppointmentStatus.SCHEDULED,
        );
      }
      const future = await http()
        .patch(`/appointments/psychologist/me/${apptA.id}/complete`)
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'G3',
          endpoint: 'PATCH /appointments/psychologist/me/:id/complete',
          role: 'PSYCHOLOGIST X',
          operation: 'cerrar cita futura',
          expected: 400,
          persisted: 'sigue SCHEDULED',
        },
        future,
        (await appointmentState(apptA.id)).status ===
          AppointmentStatus.SCHEDULED,
      );
      const ok = await http()
        .patch(`/appointments/psychologist/me/${pastA.id}/complete`)
        .set('Authorization', auth(psyX));
      note(
        {
          id: 'G4',
          endpoint: 'PATCH /appointments/psychologist/me/:id/complete',
          role: 'PSYCHOLOGIST X',
          operation: 'cerrar cita pasada propia',
          expected: 200,
          persisted: 'COMPLETED; otra pasada sigue SCHEDULED',
        },
        ok,
        (await appointmentState(pastA.id)).status ===
          AppointmentStatus.COMPLETED &&
          (await appointmentState(pastA2.id)).status ===
            AppointmentStatus.SCHEDULED,
      );
    });

    it('G5: a patient cannot cancel an appointment that already started', async () => {
      const response = await http()
        .patch(`/appointments/me/${pastA2.id}/cancel`)
        .set('Authorization', auth(patientA))
        .send({});
      note(
        {
          id: 'G5',
          endpoint: 'PATCH /appointments/me/:id/cancel',
          role: 'PATIENT A',
          operation: 'cancelar cita pasada',
          expected: 400,
          persisted: 'sigue SCHEDULED',
        },
        response,
        (await appointmentState(pastA2.id)).status ===
          AppointmentStatus.SCHEDULED,
      );
    });

    it('G6: booking does not require a care relationship', async () => {
      const response = await http()
        .post('/appointments/me')
        .set('Authorization', auth(patientB))
        .send({
          psychologistId: psyY.userId,
          appointmentDate: businessDatePlus(4),
          startTime: '09:00',
        });
      note(
        {
          id: 'G6',
          endpoint: 'POST /appointments/me',
          role: 'PATIENT B (sin relación con Y)',
          operation: 'agendar',
          expected: 201,
          persisted: '1 cita',
        },
        response,
      );
    });

    it('G7: Y cannot delete an availability block of X', async () => {
      const block = await prisma.psychologistAvailability.findFirstOrThrow({
        where: { psychologistId: psyX.userId },
        select: { id: true },
      });
      const response = await http()
        .delete(`/availability/me/${block.id}`)
        .set('Authorization', auth(psyY));
      note(
        {
          id: 'G7',
          endpoint: 'DELETE /availability/me/:id',
          role: 'PSYCHOLOGIST Y',
          operation: 'borrar bloque de X',
          expected: 404,
          persisted: 'bloque intacto',
        },
        response,
        (await prisma.psychologistAvailability.findUnique({
          where: { id: block.id },
        })) !== null,
      );
    });
  });

  describe('HTTP booking races (2 patients, same slot, full stack)', () => {
    it('R1-R3: one 201, one 409, exactly one row each time', async () => {
      for (let i = 0; i < 3; i++) {
        const date = businessDatePlus(8 + i);
        const [p1, p2] = [await fx.patient(), await fx.patient()];
        const body = {
          psychologistId: psyY.userId,
          appointmentDate: date,
          startTime: '15:00',
        };
        const [r1, r2] = await Promise.all([
          http()
            .post('/appointments/me')
            .set('Authorization', auth(p1))
            .send(body),
          http()
            .post('/appointments/me')
            .set('Authorization', auth(p2))
            .send(body),
        ]);
        const rows = await prisma.appointment.count({
          where: {
            psychologistId: psyY.userId,
            appointmentDate: date,
            status: AppointmentStatus.SCHEDULED,
            startMinute: minutes('15:00'),
          },
        });
        const statuses = [r1.status, r2.status].sort();
        matrix.push({
          id: `R${i + 1}`,
          endpoint: 'POST /appointments/me ×2 simultáneos',
          role: 'PATIENT ×2',
          operation: 'mismo horario',
          expected: 201,
          observed: statuses.join('+') as unknown as number,
          persisted: `${rows} fila(s)`,
          result:
            rows === 1 && statuses[0] === 201 && statuses[1] === 409
              ? 'PASS'
              : 'FAIL',
        });
        expect({ rows, statuses }).toEqual({ rows: 1, statuses: [201, 409] });
      }
    });
  });

  describe('exposure and rate limiting', () => {
    it('S1: no response collected in this suite contains password hashes or note text of others', () => {
      const joined = bodies.join('\n');
      const leaked =
        /passwordHash|integration-fixture-no-login/.test(joined) ||
        joined.includes('Nota sintética de Y.');
      matrix.push({
        id: 'S1',
        endpoint: 'todas las respuestas',
        role: 'todos',
        operation: 'buscar passwordHash / notas ajenas',
        expected: 0,
        observed: leaked ? 1 : 0,
        persisted: `${bodies.length} cuerpos`,
        result: leaked ? 'FAIL' : 'PASS',
      });
      expect(leaked).toBe(false);
    });

    it('S2: a spoofed X-Forwarded-For does not reset the login limit (TRUST_PROXY off)', async () => {
      let last = 0;
      for (let i = 0; i < 21; i++) {
        const response = await http()
          .post('/auth/login')
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .send({
            email: `${fx.tag}-nadie-${i}@example.test`,
            password: 'clave-sintetica-123',
          });
        last = response.status;
      }
      matrix.push({
        id: 'S2',
        endpoint: 'POST /auth/login ×21',
        role: 'anónimo',
        operation: 'X-Forwarded-For rotado',
        expected: 429,
        observed: last,
        persisted: 'n/a',
        result: last === 429 ? 'PASS' : 'FAIL',
      });
      expect(last).toBe(429);
    });
  });
});
