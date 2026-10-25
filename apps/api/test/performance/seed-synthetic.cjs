// Seeds SYNTHETIC volume into a LOCAL, DISPOSABLE test database for read-load tests.
// Refuses any non-local host or a database whose name does not contain "test".
// Usage: PERF_DATABASE_URL=... PERF_FIXTURES_OUT=fixtures.json node test/performance/seed-synthetic.cjs
const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { Client } = require('pg');

const raw = process.env.PERF_DATABASE_URL;
if (!raw) throw new Error('PERF_DATABASE_URL is required (local disposable database).');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || !/test/i.test(url.pathname)) {
  throw new Error('Refusing to seed: only a local database whose name contains "test".');
}

const PSYCHOLOGISTS = Number(process.env.PERF_PSYCHOLOGISTS ?? 5);
const PATIENTS = Number(process.env.PERF_PATIENTS ?? 300);
const APPOINTMENTS_PER_PATIENT = Number(process.env.PERF_APPOINTMENTS_PER_PATIENT ?? 10);
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const tag = `perf${Date.now().toString(36)}`;
const id = () => `c${randomBytes(12).toString('hex')}`;

function bogotaDate(offsetDays) {
  const now = new Date(Date.now() - 5 * 3600 * 1000); // America/Bogota is UTC-5 (no DST)
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

async function insert(client, table, columns, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = [];
    const params = chunk.map((row, r) =>
      `(${row.map((_, c) => { values.push(row[c]); return `$${r * row.length + c + 1}`; }).join(',')})`,
    );
    await client.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES ${params.join(',')}`, values);
  }
}

(async () => {
  const client = new Client({ connectionString: raw });
  await client.connect();
  const [{ db }] = (await client.query('select current_database() as db')).rows;
  if (!/test/i.test(db)) throw new Error('Connected database is not a test database.');
  const now = new Date();
  const users = [];
  const staff = [];
  const patients = [];
  const availability = [];
  const appointments = [];
  const relationships = [];
  const notes = [];
  const fixtures = { tag, psychologists: [], patients: [], admin: null };

  for (let p = 0; p < PSYCHOLOGISTS; p++) {
    const userId = id();
    users.push([userId, `${tag}-psy-${p}@example.test`, 'perf-fixture-no-login', 'PSYCHOLOGIST', true, now, now]);
    staff.push([id(), userId, `Psicólogo Sintético ${p}`, 'Psicólogo', now, now]);
    for (const day of DAYS) availability.push([id(), userId, day, 6 * 60, 22 * 60, true, now, now]);
    fixtures.psychologists.push(userId);
  }
  const adminId = id();
  users.push([adminId, `${tag}-admin@example.test`, 'perf-fixture-no-login', 'ADMIN', true, now, now]);
  staff.push([id(), adminId, 'Admin Sintético', 'Administrador', now, now]);
  fixtures.admin = adminId;

  const used = new Set();
  for (let i = 0; i < PATIENTS; i++) {
    const userId = id();
    const patientId = id();
    users.push([userId, `${tag}-patient-${i}@example.test`, 'perf-fixture-no-login', 'PATIENT', true, now, now]);
    patients.push([patientId, userId, `MP-PERF-${tag}-${i}`, `Paciente Sintético ${i}`, now, now]);
    fixtures.patients.push(userId);
    const psychologistId = fixtures.psychologists[i % PSYCHOLOGISTS];
    if (i % 3 === 0) {
      relationships.push([id(), patientId, psychologistId, true, now, null, now, now]);
    }
    for (let a = 0; a < APPOINTMENTS_PER_PATIENT; a++) {
      const offset = a < APPOINTMENTS_PER_PATIENT - 2 ? -1 - ((i * 7 + a * 3) % 90) : 2 + ((i + a) % 40);
      let start = (6 + ((i + a * 5) % 15)) * 60;
      let key = `${psychologistId}|${bogotaDate(offset)}|${start}`;
      while (used.has(key)) { start = 6 * 60 + ((start - 6 * 60 + 60) % (15 * 60)); key = `${psychologistId}|${bogotaDate(offset)}|${start}`; }
      used.add(key);
      const status = offset > 0 ? 'SCHEDULED' : ['COMPLETED', 'COMPLETED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'][(i + a) % 5];
      const appointmentId = id();
      appointments.push([appointmentId, patientId, psychologistId, bogotaDate(offset), start, start + 60, status, now, now]);
      if (status === 'COMPLETED' && i % 3 === 0 && a % 2 === 0) {
        notes.push([id(), patientId, psychologistId, appointmentId, 'Contenido sintético de prueba de carga.', now, now]);
      }
    }
  }

  await client.query('BEGIN');
  await insert(client, 'User', ['id', 'email', 'passwordHash', 'role', 'isActive', 'createdAt', 'updatedAt'], users);
  await insert(client, 'StaffProfile', ['id', 'userId', 'fullName', 'position', 'createdAt', 'updatedAt'], staff);
  await insert(client, 'Patient', ['id', 'userId', 'mrn', 'fullName', 'createdAt', 'updatedAt'], patients);
  await insert(client, 'PsychologistAvailability', ['id', 'psychologistId', 'dayOfWeek', 'startMinute', 'endMinute', 'isActive', 'createdAt', 'updatedAt'], availability);
  await insert(client, 'Appointment', ['id', 'patientId', 'psychologistId', 'appointmentDate', 'startMinute', 'endMinute', 'status', 'createdAt', 'updatedAt'], appointments);
  await insert(client, 'CareRelationship', ['id', 'patientId', 'psychologistId', 'isActive', 'assignedAt', 'endedAt', 'createdAt', 'updatedAt'], relationships);
  await insert(client, 'ClinicalSessionNote', ['id', 'patientId', 'psychologistId', 'appointmentId', 'content', 'createdAt', 'updatedAt'], notes);
  await client.query('COMMIT');
  await client.end();

  const counts = { users: users.length, patients: patients.length, appointments: appointments.length, relationships: relationships.length, notes: notes.length };
  if (process.env.PERF_FIXTURES_OUT) writeFileSync(process.env.PERF_FIXTURES_OUT, JSON.stringify({ ...fixtures, counts }, null, 2));
  console.log('seeded', counts);
})().catch((error) => {
  console.error('seed failed:', error.code ?? error.message);
  process.exitCode = 1;
});
