// Level I (service + real PostgreSQL, disposable): booking races with REAL transactions.
// Both requests are started in the same tick (no await between them), so both can read
// the slot as free before either writes. Integrity is checked by counting rows in the DB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { AppointmentStatus, UserRole } from '../../generated/prisma/enums';
import { PrismaService } from '../../src/database/prisma.service';
import { AppointmentLifecycleService } from '../../src/modules/appointments/appointment-lifecycle.service';
import { AppointmentsService } from '../../src/modules/appointments/appointments.service';
import { PushDispatcher } from '../../src/modules/push/push-dispatcher';
import { ClinicalAccessService } from '../../src/modules/clinical/clinical-access.service';
import { ClinicalService } from '../../src/modules/clinical/clinical.service';
import { ClinicalTransactionService } from '../../src/modules/clinical/clinical-transaction.service';
import {
  assertDisposableDatabase,
  businessDatePlus,
  Fixtures,
  minutes,
  percentile,
  type FixtureUser,
} from './support/fixtures';

type Outcome = { status: number; ms: number };

interface RaceRow {
  name: string;
  attempts: number;
  ok: number;
  conflict409: number;
  client4xx: number;
  server5xx: number;
  integrityViolations: number;
  p95ms: number;
}

const report: RaceRow[] = [];

async function timed(call: () => Promise<unknown>): Promise<Outcome> {
  const started = performance.now();
  try {
    await call();
    return { status: 200, ms: performance.now() - started };
  } catch (error: unknown) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    return { status, ms: performance.now() - started };
  }
}

// Starts every call before awaiting any of them.
function simultaneously(calls: (() => Promise<unknown>)[]): Promise<Outcome[]> {
  return Promise.all(calls.map((call) => timed(call)));
}

function record(name: string, outcomes: Outcome[][], violations: number) {
  const flat = outcomes.flat();
  report.push({
    name,
    attempts: outcomes.length,
    ok: flat.filter((o) => o.status < 300).length,
    conflict409: flat.filter((o) => o.status === 409).length,
    client4xx: flat.filter(
      (o) => o.status >= 400 && o.status < 500 && o.status !== 409,
    ).length,
    server5xx: flat.filter((o) => o.status >= 500).length,
    integrityViolations: violations,
    p95ms: Math.round(
      percentile(
        flat.map((o) => o.ms),
        95,
      ),
    ),
  });
}

const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

describe('Booking concurrency against a disposable PostgreSQL (Level I, service + DB)', () => {
  const prisma = new PrismaService();
  const fixtures = new Fixtures(prisma);
  // Push is disabled (no PUSH_ENABLED): kick() is a no-op.
  const appointments = new AppointmentsService(
    prisma,
    new PushDispatcher(prisma),
  );
  const lifecycle = new AppointmentLifecycleService(prisma);
  const clinical = new ClinicalService(
    new ClinicalTransactionService(prisma),
    new ClinicalAccessService(),
  );

  beforeAll(async () => {
    await prisma.$connect();
    await assertDisposableDatabase(prisma);
  });

  afterAll(async () => {
    const dir = process.env.AUDIT_RESULTS_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'concurrency-results.json'),
        JSON.stringify(report, null, 2),
      );
    }
    console.table(report);
    await fixtures.cleanup();
    await prisma.$disconnect();
  });

  async function overlappingScheduled(
    where: { psychologistId?: string; patientId?: string },
    date: string,
    start: number,
    end: number,
  ) {
    return prisma.appointment.count({
      where: {
        ...where,
        appointmentDate: date,
        status: AppointmentStatus.SCHEDULED,
        startMinute: { lt: end },
        endMinute: { gt: start },
      },
    });
  }

  it('20 races: two patients book the same psychologist and slot at the same time', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 20; i++) {
      const date = businessDatePlus(2 + (i % 10));
      const start = minutes('07:00') + Math.floor(i / 10) * 60 * 3;
      const [a, b] = [await fixtures.patient(), await fixtures.patient()];
      const body = {
        psychologistId: psychologist.userId,
        appointmentDate: date,
        startTime: time(start),
      };
      const result = await simultaneously([
        () => appointments.create(a.userId, body),
        () => appointments.create(b.userId, body),
      ]);
      outcomes.push(result);
      const rows = await overlappingScheduled(
        { psychologistId: psychologist.userId },
        date,
        start,
        start + 60,
      );
      if (rows > 1) violations += 1;
    }
    record('Mismo psicólogo y horario (2 pacientes)', outcomes, violations);
    expect(violations).toBe(0);
    expect(outcomes.flat().filter((o) => o.status >= 500)).toHaveLength(0);
  });

  it('overlapping off-grid times (09:00 vs 09:30) never leave two active appointments', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const date = businessDatePlus(3 + i);
      const [a, b] = [await fixtures.patient(), await fixtures.patient()];
      const result = await simultaneously([
        () =>
          appointments.create(a.userId, {
            psychologistId: psychologist.userId,
            appointmentDate: date,
            startTime: '09:00',
          }),
        () =>
          appointments.create(b.userId, {
            psychologistId: psychologist.userId,
            appointmentDate: date,
            startTime: '09:30',
          }),
      ]);
      outcomes.push(result);
      if (
        (await overlappingScheduled(
          { psychologistId: psychologist.userId },
          date,
          minutes('09:00'),
          minutes('10:30'),
        )) > 1
      )
        violations += 1;
    }
    record('Intervalos superpuestos 09:00 vs 09:30', outcomes, violations);
    expect(violations).toBe(0);
  });

  it('one patient booking two psychologists at the same time keeps one active appointment', async () => {
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const date = businessDatePlus(4 + i);
      const [x, y] = [
        await fixtures.psychologist(),
        await fixtures.psychologist(),
      ];
      const patient = await fixtures.patient();
      const result = await simultaneously([
        () =>
          appointments.create(patient.userId, {
            psychologistId: x.userId,
            appointmentDate: date,
            startTime: '11:00',
          }),
        () =>
          appointments.create(patient.userId, {
            psychologistId: y.userId,
            appointmentDate: date,
            startTime: '11:00',
          }),
      ]);
      outcomes.push(result);
      if (
        (await overlappingScheduled(
          { patientId: patient.patientId },
          date,
          minutes('11:00'),
          minutes('12:00'),
        )) > 1
      )
        violations += 1;
    }
    record('Un paciente, dos psicólogos, misma hora', outcomes, violations);
    expect(violations).toBe(0);
  });

  it('reschedule into a slot that another patient books at the same time', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const date = businessDatePlus(5 + i);
      const [a, b] = [await fixtures.patient(), await fixtures.patient()];
      const existing = await fixtures.appointment(
        a,
        psychologist,
        date,
        minutes('08:00'),
      );
      const result = await simultaneously([
        () =>
          appointments.reschedule(a.userId, existing.id, {
            appointmentDate: date,
            startTime: '15:00',
          }),
        () =>
          appointments.create(b.userId, {
            psychologistId: psychologist.userId,
            appointmentDate: date,
            startTime: '15:00',
          }),
      ]);
      outcomes.push(result);
      if (
        (await overlappingScheduled(
          { psychologistId: psychologist.userId },
          date,
          minutes('15:00'),
          minutes('16:00'),
        )) > 1
      )
        violations += 1;
    }
    record('Reagendar vs agendar al mismo horario', outcomes, violations);
    expect(violations).toBe(0);
  });

  it('two simultaneous reschedules of the same appointment: no lost update', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const date = businessDatePlus(6 + i);
      const patient = await fixtures.patient();
      const existing = await fixtures.appointment(
        patient,
        psychologist,
        date,
        minutes('08:00'),
      );
      const result = await simultaneously([
        () =>
          appointments.reschedule(patient.userId, existing.id, {
            appointmentDate: date,
            startTime: '13:00',
          }),
        () =>
          appointments.reschedule(patient.userId, existing.id, {
            appointmentDate: date,
            startTime: '17:00',
          }),
      ]);
      outcomes.push(result);
      const winners = result.filter((o) => o.status < 300).length;
      const final = await prisma.appointment.findUniqueOrThrow({
        where: { id: existing.id },
        select: { startMinute: true },
      });
      // Two "success" answers for incompatible values means one update was silently lost.
      if (
        winners !== 1 ||
        ![minutes('13:00'), minutes('17:00')].includes(final.startMinute)
      )
        violations += 1;
    }
    record(
      'Dos reagendamientos simultáneos de la misma cita',
      outcomes,
      violations,
    );
    expect(violations).toBe(0);
  });

  it('cancel and reschedule of the same appointment at the same time', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const date = businessDatePlus(7 + i);
      const patient = await fixtures.patient();
      const existing = await fixtures.appointment(
        patient,
        psychologist,
        date,
        minutes('08:00'),
      );
      const [cancel, reschedule] = await simultaneously([
        () => appointments.cancel(patient.userId, existing.id, {}),
        () =>
          appointments.reschedule(patient.userId, existing.id, {
            appointmentDate: date,
            startTime: '18:00',
          }),
      ]);
      outcomes.push([cancel, reschedule]);
      const final = await prisma.appointment.findUniqueOrThrow({
        where: { id: existing.id },
        select: { status: true, startMinute: true },
      });
      const cancelled = final.status === AppointmentStatus.CANCELLED;
      const moved =
        final.status === AppointmentStatus.SCHEDULED &&
        final.startMinute === minutes('18:00');
      // Final state must match the answers: a "cancelled" answer cannot end SCHEDULED, and vice versa.
      const consistent =
        (cancel.status < 300 && reschedule.status >= 400 && cancelled) ||
        (reschedule.status < 300 && cancel.status >= 400 && moved);
      if (!consistent) violations += 1;
    }
    record('Cancelar vs reagendar la misma cita', outcomes, violations);
    expect(violations).toBe(0);
  });

  it('complete vs no-show at the same time: one winner, one audit entry', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const patient = await fixtures.patient();
      const past = await fixtures.appointment(
        patient,
        psychologist,
        businessDatePlus(-1 - i),
        minutes('09:00'),
      );
      const result = await simultaneously([
        () =>
          lifecycle.finish(
            psychologist.userId,
            past.id,
            AppointmentStatus.COMPLETED,
          ),
        () =>
          lifecycle.finish(
            psychologist.userId,
            past.id,
            AppointmentStatus.NO_SHOW,
          ),
      ]);
      outcomes.push(result);
      const audits = await prisma.auditLog.count({
        where: { resourceId: past.id },
      });
      if (result.filter((o) => o.status < 300).length !== 1 || audits !== 1)
        violations += 1;
    }
    record('Realizada vs inasistencia simultáneas', outcomes, violations);
    expect(violations).toBe(0);
  });

  it('two notes linked to the same appointment at the same time: at most one', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const patient = await fixtures.patient();
      await fixtures.careRelationship(patient, psychologist);
      const done = await fixtures.appointment(
        patient,
        psychologist,
        businessDatePlus(-2 - i),
        minutes('10:00'),
        'COMPLETED',
      );
      const dto = {
        content: 'Texto sintético de prueba.',
        appointmentId: done.id,
      };
      const result = await simultaneously([
        () => clinical.createNote(psychologist.userId, patient.patientId!, dto),
        () => clinical.createNote(psychologist.userId, patient.patientId!, dto),
      ]);
      outcomes.push(result);
      if (
        (await prisma.clinicalSessionNote.count({
          where: { appointmentId: done.id },
        })) !== 1
      )
        violations += 1;
    }
    record('Dos notas para la misma cita', outcomes, violations);
    expect(violations).toBe(0);
    expect(outcomes.flat().filter((o) => o.status >= 500)).toHaveLength(0);
  });

  it('upcoming-appointment cap (4) holds when the last two bookings race', async () => {
    const psychologist = await fixtures.psychologist();
    const outcomes: Outcome[][] = [];
    let violations = 0;
    for (let i = 0; i < 5; i++) {
      const patient: FixtureUser = await fixtures.patient();
      for (const offset of [2, 3, 4])
        await fixtures.appointment(
          patient,
          psychologist,
          businessDatePlus(offset + i * 5),
          minutes('07:00'),
        );
      const date = businessDatePlus(20 + i);
      const result = await simultaneously([
        () =>
          appointments.create(patient.userId, {
            psychologistId: psychologist.userId,
            appointmentDate: date,
            startTime: '12:00',
          }),
        () =>
          appointments.create(patient.userId, {
            psychologistId: psychologist.userId,
            appointmentDate: date,
            startTime: '14:00',
          }),
      ]);
      outcomes.push(result);
      const upcoming = await prisma.appointment.count({
        where: {
          patientId: patient.patientId,
          status: AppointmentStatus.SCHEDULED,
          appointmentDate: { gte: businessDatePlus(0) },
        },
      });
      if (upcoming > 4) violations += 1;
    }
    record('Límite de 4 citas futuras en carrera', outcomes, violations);
    expect(violations).toBe(0);
  });

  it('fixtures are synthetic and the role model is respected', () => {
    expect(fixtures.tag).toMatch(/^it/);
    expect(UserRole.PATIENT).toBe('PATIENT');
  });
});
