// Patient sign-up with data-policy acceptance, profile completion and the booking
// guard, over HTTP against the disposable PostgreSQL. Synthetic accounts only.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Gender, UserRole } from '../../generated/prisma/enums';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import {
  DATA_POLICY_REQUIRED_MESSAGE,
  MINOR_BOOKING_MESSAGE,
  PROFILE_INCOMPLETE_MESSAGE,
} from '../../src/modules/patients/patient-requirements';
import {
  assertDisposableDatabase,
  businessDatePlus,
  Fixtures,
  type FixtureUser,
} from './support/fixtures';

describe('Patient sign-up, data-policy evidence and onboarding (disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let fx: Fixtures;
  let psychologist: FixtureUser;
  let admin: FixtureUser;
  let policy: { id: string; version: string; sha256: string };
  const password = `Sintetica-${randomBytes(6).toString('hex')}`;
  const bookingDate = businessDatePlus(5);
  let slot = 8 * 60;

  const http = () => request(app.getHttpServer());
  const auth = (user: FixtureUser) => fx.token(jwt, user);
  const nextTime = () => {
    slot += 60;
    return `${String(Math.floor(slot / 60)).padStart(2, '0')}:00`;
  };
  const book = (token: string) =>
    http()
      .post('/appointments/me')
      .set('Authorization', token)
      .send({
        psychologistId: psychologist.userId,
        appointmentDate: bookingDate,
        startTime: nextTime(),
      });
  const email = (label: string) => `${fx.tag}-${label}@example.test`;
  const register = (body: Record<string, unknown>) =>
    http().post('/users').send(body);
  const userByEmail = (address: string) =>
    prisma.user.findUnique({
      where: { email: address },
      select: { id: true, patientProfile: { select: { id: true } } },
    });

  beforeAll(async () => {
    // Many sign-ups from one IP: the per-IP limits (covered by auth-security e2e)
    // are switched off for this suite only.
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getOptionsToken())
      .useValue({ throttlers: [{ name: 'default', ttl: 60_000, limit: 10_000 }], skipIf: () => true })
      .compile();
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
    psychologist = await fx.psychologist();
    admin = await fx.staffUser(UserRole.ADMIN);
    policy = await fx.publishPolicy();
  });

  afterAll(async () => {
    await fx?.cleanup();
    await app?.close();
  });

  describe('registration', () => {
    it('rejects a sign-up without acceptance, with acceptance = false or with another version, writing nothing', async () => {
      const cases: Record<string, unknown>[] = [
        { email: email('noaccept'), password, dataPolicyVersion: policy.version },
        { email: email('false'), password, acceptDataPolicy: false, dataPolicyVersion: policy.version },
        { email: email('noversion'), password, acceptDataPolicy: true },
        { email: email('badversion'), password, acceptDataPolicy: true, dataPolicyVersion: 'no-existe' },
      ];
      for (const body of cases) {
        const response = await register(body).expect(400);
        expect(JSON.stringify(response.body)).toMatch(/Pol[ií]tica|política/i);
        expect(await userByEmail(body.email as string)).toBeNull();
      }
    });

    it('rejects fields the client may not set (acceptance date, profile flag, role)', async () => {
      for (const extra of [
        { consentAcceptedAt: '2020-01-01T00:00:00Z' },
        { isProfileComplete: true },
        { role: 'ADMIN' },
      ]) {
        await register({
          email: email('extra'),
          password,
          acceptDataPolicy: true,
          dataPolicyVersion: policy.version,
          ...extra,
        }).expect(400);
      }
      expect(await userByEmail(email('extra'))).toBeNull();
    });

    it('creates user, empty profile and evidence together; the time comes from the server', async () => {
      const before = Date.now();
      const response = await register({
        email: email('new'),
        password,
        acceptDataPolicy: true,
        dataPolicyVersion: policy.version,
      }).expect(201);
      const after = Date.now();
      fx.track(response.body.id);
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|sha256|acceptedAt/);

      const consents = await prisma.dataProcessingConsent.findMany({
        where: { userId: response.body.id },
      });
      expect(consents).toHaveLength(1);
      expect(consents[0]).toMatchObject({
        documentId: policy.id,
        documentVersion: policy.version,
        documentSha256: policy.sha256,
        purpose: 'ACCOUNT_DATA_PROCESSING',
        source: 'PATIENT_REGISTRATION',
      });
      const acceptedAt = consents[0].acceptedAt.getTime();
      expect(acceptedAt).toBeGreaterThanOrEqual(before - 5_000);
      expect(acceptedAt).toBeLessThanOrEqual(after + 5_000);
      const patient = await prisma.patient.findUnique({
        where: { userId: response.body.id },
      });
      expect(patient).toMatchObject({ fullName: null, birthDate: null, phone: null });
    });

    it('a failure while saving the evidence leaves no partial account', async () => {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION mp_test_fail_consent() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'simulated consent failure'; END $$`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "zz_test_fail_consent" BEFORE INSERT ON "DataProcessingConsent" FOR EACH ROW EXECUTE FUNCTION mp_test_fail_consent()`,
      );
      try {
        await register({
          email: email('partial'),
          password,
          acceptDataPolicy: true,
          dataPolicyVersion: policy.version,
        }).expect(500);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "zz_test_fail_consent" ON "DataProcessingConsent"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS mp_test_fail_consent()`);
      }
      expect(await userByEmail(email('partial'))).toBeNull();
    });
  });

  describe('new patient: login, profile, booking', () => {
    let token: string;

    it('logs in and reports a pending profile; booking is refused by the API (409)', async () => {
      const created = await register({
        email: email('flow'),
        password,
        acceptDataPolicy: true,
        dataPolicyVersion: policy.version,
      }).expect(201);
      fx.track(created.body.id);
      const login = await http()
        .post('/auth/login')
        .send({ email: email('flow'), password })
        .expect(201);
      token = `Bearer ${login.body.accessToken}`;

      const me = await http().get('/patients/me').set('Authorization', token).expect(200);
      expect(me.body).toMatchObject({
        isProfileComplete: false,
        dataPolicyAccepted: true,
        currentDataPolicyVersion: policy.version,
      });

      const refused = await book(token).expect(409);
      expect(refused.body.message).toBe(PROFILE_INCOMPLETE_MESSAGE);
      expect(await prisma.appointment.count({ where: { patientId: me.body.id } })).toBe(0);
    });

    it('rejects names made of spaces, future or impossible birth dates and blank phones', async () => {
      const valid = { fullName: 'Paciente Sintética', birthDate: '1992-04-10', gender: Gender.PREFER_NOT_TO_SAY, phone: '3001112233' };
      for (const invalid of [
        { fullName: '     ' },
        { fullName: ' a ' },
        { birthDate: businessDatePlus(1) },
        { birthDate: '2023-02-30' },
        { birthDate: '1899-12-31' },
        { phone: '         ' },
        { phone: 'abcdefghij' },
        { gender: 'ALIEN' },
        { gender: Gender.OTHER, genderOther: '   ' },
      ]) {
        await http().patch('/patients/me').set('Authorization', token).send({ ...valid, ...invalid }).expect(400);
      }
      const me = await http().get('/patients/me').set('Authorization', token).expect(200);
      expect(me.body.isProfileComplete).toBe(false);
    });

    it('PREFER_NOT_TO_SAY completes the profile; then booking works', async () => {
      const saved = await http()
        .patch('/patients/me')
        .set('Authorization', token)
        .send({ fullName: '  Paciente Sintética  ', birthDate: '1992-04-10', gender: Gender.PREFER_NOT_TO_SAY, phone: '300 111 2233' })
        .expect(200);
      expect(saved.body).toMatchObject({ isProfileComplete: true, fullName: 'Paciente Sintética', gender: 'PREFER_NOT_TO_SAY' });
      await book(token).expect(201);
    });

    it('normal editing keeps working for a complete profile', async () => {
      const edited = await http().patch('/patients/me').set('Authorization', token).send({ phone: '+57 (300) 999-8877' }).expect(200);
      expect(edited.body).toMatchObject({ phone: '+57 (300) 999-8877', isProfileComplete: true });
    });
  });

  describe('existing accounts', () => {
    it('without evidence: must accept explicitly before editing or booking; nothing is assumed', async () => {
      const patient = await fx.patient('Paciente Antiguo', { consent: false });
      const me = await http().get('/patients/me').set('Authorization', auth(patient)).expect(200);
      expect(me.body).toMatchObject({ isProfileComplete: true, dataPolicyAccepted: false });
      expect(await prisma.dataProcessingConsent.count({ where: { userId: patient.userId } })).toBe(0);

      const edit = await http().patch('/patients/me').set('Authorization', auth(patient)).send({ phone: '3005556677' }).expect(409);
      expect(edit.body.message).toBe(DATA_POLICY_REQUIRED_MESSAGE);
      expect((await book(auth(patient)).expect(409)).body.message).toBe(DATA_POLICY_REQUIRED_MESSAGE);

      await http().post('/patients/me/data-policy-acceptance').set('Authorization', auth(patient)).send({ acceptDataPolicy: true, dataPolicyVersion: 'otra' }).expect(400);
      await http().post('/patients/me/data-policy-acceptance').set('Authorization', auth(patient)).send({ dataPolicyVersion: policy.version }).expect(400);
      const accepted = await http().post('/patients/me/data-policy-acceptance').set('Authorization', auth(patient)).send({ acceptDataPolicy: true, dataPolicyVersion: policy.version }).expect(201);
      expect(accepted.body).toMatchObject({ dataPolicyAccepted: true, dataPolicyVersion: policy.version });
      // Accepting again keeps the first record.
      await http().post('/patients/me/data-policy-acceptance').set('Authorization', auth(patient)).send({ acceptDataPolicy: true, dataPolicyVersion: policy.version }).expect(201);
      const rows = await prisma.dataProcessingConsent.findMany({ where: { userId: patient.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('EXISTING_ACCOUNT');
      await book(auth(patient)).expect(201);
    });

    it('incomplete profile: booking refused, but an existing appointment can still be cancelled', async () => {
      const patient = await fx.patient('Paciente Incompleto', { complete: false });
      const existing = await fx.appointment(patient, psychologist, businessDatePlus(6), 9 * 60);
      const before = await prisma.appointment.findUniqueOrThrow({ where: { id: existing.id } });

      expect((await book(auth(patient)).expect(409)).body.message).toBe(PROFILE_INCOMPLETE_MESSAGE);
      const untouched = await prisma.appointment.findUniqueOrThrow({ where: { id: existing.id } });
      expect(untouched).toEqual(before);

      await http().patch(`/appointments/me/${existing.id}/cancel`).set('Authorization', auth(patient)).send({}).expect(200);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: existing.id } })).status).toBe('CANCELLED');
    });

    it('a minor is not booked online (pending representation procedure)', async () => {
      const patient = await fx.patient('Paciente Menor');
      await prisma.patient.update({ where: { userId: patient.userId }, data: { birthDate: new Date(`${businessDatePlus(-365 * 10)}T00:00:00.000Z`) } });
      expect((await book(auth(patient)).expect(409)).body.message).toBe(MINOR_BOOKING_MESSAGE);
    });

    it('a new version that requires re-acceptance asks again; an editorial one does not', async () => {
      const patient = await fx.patient('Paciente Versiones');
      const status = async () => (await http().get('/patients/me').set('Authorization', auth(patient)).expect(200)).body.dataPolicyAccepted;
      expect(await status()).toBe(true);
      await fx.publishPolicy(`${fx.tag}-editorial`, false);
      expect(await status()).toBe(true);
      const v2 = await fx.publishPolicy(`${fx.tag}-v2`, true);
      expect(await status()).toBe(false);
      await book(auth(patient)).expect(409);
      await http().post('/patients/me/data-policy-acceptance').set('Authorization', auth(patient)).send({ acceptDataPolicy: true, dataPolicyVersion: v2.version }).expect(201);
      expect(await status()).toBe(true);
      policy = v2;
    });
  });

  describe('evidence integrity and other roles', () => {
    it('evidence and published texts cannot be edited; a wrong hash is refused', async () => {
      // Single autocommit statements (database triggers and CHECK constraints).
      const row = await prisma.dataProcessingConsent.findFirstOrThrow({ where: { documentId: policy.id } });
      await expect(prisma.$executeRaw`UPDATE "DataProcessingConsent" SET "acceptedAt" = '2000-01-01' WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`UPDATE "LegalDocument" SET title = 'Cambiado' WHERE id = ${policy.id}`).rejects.toThrow(/immutable/);
      await expect(
        prisma.$executeRaw`INSERT INTO "LegalDocument" (id, kind, version, title, body, sha256) VALUES (${`${fx.tag}-bad`}, 'DATA_PROCESSING_POLICY', ${`${fx.tag}-badhash`}, 'x', 'texto', ${'0'.repeat(64)})`,
      ).rejects.toThrow(/LegalDocument_values/);
      expect((await prisma.dataProcessingConsent.findUniqueOrThrow({ where: { id: row.id } })).acceptedAt).toEqual(row.acceptedAt);
    });

    it('the public endpoint serves the current version only', async () => {
      const current = await http().get('/legal/data-processing-policy').expect(200);
      expect(current.body).toMatchObject({ version: policy.version, sha256: policy.sha256 });
      expect(JSON.stringify(current.body)).not.toMatch(/userId|consent/i);
    });

    it('psychologist and admin are not sent through the patient flow', async () => {
      await http().get('/auth/me').set('Authorization', auth(psychologist)).expect(200);
      await http().get('/appointments/psychologist/me').set('Authorization', auth(psychologist)).expect(200);
      await http().get('/auth/me').set('Authorization', auth(admin)).expect(200);
      await http().get('/patients/me').set('Authorization', auth(psychologist)).expect(403);
    });
  });
});
