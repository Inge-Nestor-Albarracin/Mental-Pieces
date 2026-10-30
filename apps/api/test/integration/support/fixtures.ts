// Synthetic fixtures for the disposable integration database. No real people or notes.
import { randomBytes } from 'node:crypto';
import type { JwtService } from '@nestjs/jwt';
import {
  ConsentPurpose,
  ConsentSource,
  Gender,
  LegalDocumentKind,
  UserRole,
  WeekDay,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../src/database/prisma.service';
import { businessNow } from '../../../src/modules/appointments/appointment-time';
import { policySha256 } from '../../../src/modules/legal/data-policy';

const ALL_DAYS = Object.values(WeekDay);
// Not a bcrypt hash: these accounts never log in with a password.
const NO_LOGIN_HASH = 'integration-fixture-no-login';

export interface FixtureUser {
  userId: string;
  role: UserRole;
  email: string;
  patientId?: string;
}

export async function assertDisposableDatabase(prisma: PrismaService) {
  const [row] = await prisma.$queryRaw<
    { db: string }[]
  >`select current_database() as db`;
  if (!/test/i.test(row.db)) {
    throw new Error(
      'Refusing to write: connected database is not a test database.',
    );
  }
}

export class Fixtures {
  readonly tag = `it${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  private counter = 0;
  private readonly userIds: string[] = [];
  private readonly policyIds: string[] = [];
  private policy?: { id: string; version: string; sha256: string };

  constructor(private readonly prisma: PrismaService) {}

  // A synthetic published policy (not a real legal text), one per fixture run.
  async publishPolicy(
    version = `${this.tag}-v${this.policyIds.length + 1}`,
    requiresReacceptance = true,
  ) {
    const body = `Política sintética de pruebas ${version}. No es un texto legal.`;
    const created = await this.prisma.legalDocument.create({
      data: {
        kind: LegalDocumentKind.DATA_PROCESSING_POLICY,
        version,
        title: 'Política sintética',
        body,
        sha256: policySha256(body),
        requiresReacceptance,
      },
      select: { id: true, version: true, sha256: true },
    });
    this.policyIds.push(created.id);
    this.policy = created;
    return created;
  }

  async currentPolicy() {
    return this.policy ?? this.publishPolicy();
  }

  async consent(userId: string) {
    const policy = await this.currentPolicy();
    await this.prisma.dataProcessingConsent.create({
      data: {
        userId,
        documentId: policy.id,
        purpose: ConsentPurpose.ACCOUNT_DATA_PROCESSING,
        source: ConsentSource.EXISTING_ACCOUNT,
        documentVersion: policy.version,
        documentSha256: policy.sha256,
      },
    });
  }

  // Accounts registered through the API (POST /users) are cleaned up too.
  track(userId: string) {
    this.userIds.push(userId);
  }

  private email(kind: string) {
    this.counter += 1;
    return `${this.tag}-${kind}-${this.counter}@example.test`;
  }

  // By default a patient who can book: complete synthetic profile and accepted
  // policy. Onboarding tests ask for incomplete profiles or no consent.
  async patient(
    fullName = 'Paciente Sintético',
    { complete = true, consent = true } = {},
  ): Promise<FixtureUser> {
    const email = this.email('patient');
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: NO_LOGIN_HASH,
        role: UserRole.PATIENT,
        patientProfile: {
          create: {
            mrn: `MP-TEST-${this.tag}-${this.counter}`,
            fullName,
            ...(complete
              ? {
                  birthDate: new Date('1990-01-15T00:00:00.000Z'),
                  gender: Gender.PREFER_NOT_TO_SAY,
                  phone: '300 000 0000',
                }
              : {}),
          },
        },
      },
      select: { id: true, patientProfile: { select: { id: true } } },
    });
    this.userIds.push(user.id);
    if (consent) await this.consent(user.id);
    return {
      userId: user.id,
      role: UserRole.PATIENT,
      email,
      patientId: user.patientProfile!.id,
    };
  }

  async staffUser(role: UserRole, isActive = true): Promise<FixtureUser> {
    const email = this.email(role.toLowerCase());
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: NO_LOGIN_HASH,
        role,
        isActive,
        staffProfile: {
          create: { fullName: `Sintético ${role}`, position: role },
        },
      },
      select: { id: true },
    });
    this.userIds.push(user.id);
    return { userId: user.id, role, email };
  }

  // A psychologist available every day from 06:00 to 22:00.
  async psychologist(isActive = true): Promise<FixtureUser> {
    const psychologist = await this.staffUser(UserRole.PSYCHOLOGIST, isActive);
    await this.prisma.psychologistAvailability.createMany({
      data: ALL_DAYS.map((dayOfWeek) => ({
        psychologistId: psychologist.userId,
        dayOfWeek,
        startMinute: 6 * 60,
        endMinute: 22 * 60,
      })),
    });
    return psychologist;
  }

  async careRelationship(patient: FixtureUser, psychologist: FixtureUser) {
    return this.prisma.careRelationship.create({
      data: {
        patientId: patient.patientId!,
        psychologistId: psychologist.userId,
      },
      select: { id: true },
    });
  }

  async appointment(
    patient: FixtureUser,
    psychologist: FixtureUser,
    appointmentDate: string,
    startMinute: number,
    status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' = 'SCHEDULED',
  ) {
    return this.prisma.appointment.create({
      data: {
        patientId: patient.patientId!,
        psychologistId: psychologist.userId,
        appointmentDate,
        startMinute,
        endMinute: startMinute + 60,
        status,
      },
      select: { id: true },
    });
  }

  token(jwt: JwtService, user: FixtureUser, overrides: object = {}) {
    return `Bearer ${jwt.sign({ sub: user.userId, role: user.role, email: user.email, ...overrides })}`;
  }

  // Deletes only rows created by this fixture instance (FK order: children first).
  async cleanup() {
    if (this.userIds.length === 0 && this.policyIds.length === 0) return;
    const users = { in: this.userIds };
    const patients = await this.prisma.patient.findMany({
      where: { userId: users },
      select: { id: true },
    });
    const patientIds = { in: patients.map((p) => p.id) };
    await this.prisma.auditLog.deleteMany({ where: { actorUserId: users } });
    await this.prisma.notification.deleteMany({
      where: {
        OR: [
          { recipientUserId: users },
          { appointment: { psychologistId: users } },
        ],
      },
    });
    await this.prisma.clinicalSessionNote.deleteMany({
      where: { OR: [{ psychologistId: users }, { patientId: patientIds }] },
    });
    await this.prisma.appointment.deleteMany({
      where: { OR: [{ psychologistId: users }, { patientId: patientIds }] },
    });
    await this.prisma.careRelationship.deleteMany({
      where: { OR: [{ psychologistId: users }, { patientId: patientIds }] },
    });
    await this.prisma.psychologistAvailability.deleteMany({
      where: { psychologistId: users },
    });
    await this.prisma.dataProcessingConsent.deleteMany({
      where: { userId: users },
    });
    await this.prisma.patient.deleteMany({ where: { userId: users } });
    await this.prisma.staffProfile.deleteMany({ where: { userId: users } });
    await this.prisma.user.deleteMany({ where: { id: users } });
    await this.prisma.legalDocument.deleteMany({
      where: { id: { in: this.policyIds } },
    });
  }
}

// Calendar date N days after today in America/Bogota (YYYY-MM-DD).
export function businessDatePlus(days: number): string {
  const [y, m, d] = businessNow().date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}
