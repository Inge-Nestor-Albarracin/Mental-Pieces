import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const api = await load('../lib/api.ts');
const appt = await load('../lib/appointments.ts');
const originalFetch = globalThis.fetch;
const originalTz = process.env.TZ;
afterEach(() => { globalThis.fetch = originalFetch; process.env.TZ = originalTz; });

// Intl may use narrow/no-break spaces in "a. m."; compare with plain spaces.
const plain = (text) => text.replace(/[  ]/g, ' ');

// Wednesday 2026-10-14 15:00 in Bogotá.
const NOW = { date: '2026-10-14', minute: 900 };
const item = (id, appointmentDate, startTime, status) => ({
  id, appointmentDate, startTime,
  endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:${startTime.slice(3)}`,
  status,
});

test('REGRESSION: booking sends the psychologist User id, never the StaffProfile id', async () => {
  const option = { id: 'staff-profile-test', fullName: 'Psicólogo', position: null, user: { id: 'psychologist-user-test' } };
  let body;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/appointments/me');
    assert.equal(options.method, 'POST');
    body = JSON.parse(options.body);
    return Response.json({}, { status: 201 });
  };
  await api.createAppointment('test-session', {
    psychologistId: appt.bookingPsychologistId(option), appointmentDate: '2026-10-16', startTime: '09:00',
    patientId: 'untrusted', status: 'COMPLETED',
  });
  assert.deepEqual(body, { psychologistId: 'psychologist-user-test', appointmentDate: '2026-10-16', startTime: '09:00' });
  assert.ok(!JSON.stringify(body).includes('staff-profile-test'));
});

test('REGRESSION: the booking page builds option values with bookingPsychologistId', async () => {
  const source = await readFile(new URL('../app/appointments/new/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /value=\{bookingPsychologistId\(item\)\}/);
  assert.doesNotMatch(source, /value=\{(item|psychologist)\.id\}/);
});

test('available slots are requested with the User id and a YYYY-MM-DD date', async () => {
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/appointments/available-slots');
    assert.equal(parsed.searchParams.get('psychologistId'), 'psychologist-user-test');
    assert.equal(parsed.searchParams.get('date'), '2026-10-16');
    return Response.json(['07:00']);
  };
  assert.deepEqual(await api.getAvailableSlots('test-session', 'psychologist-user-test', '2026-10-16'), ['07:00']);
});

test('appointment errors keep their HTTP status', async () => {
  globalThis.fetch = async () => Response.json({ message: 'El psicólogo ya tiene otra cita programada en ese horario.' }, { status: 409 });
  await assert.rejects(api.createAppointment('t', { psychologistId: 'p', appointmentDate: '2026-10-16', startTime: '09:00' }),
    (error) => error instanceof api.ApiError && error.status === 409);
});

test('psychologist closing uses the existing lifecycle endpoints', async () => {
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(`${options.method} ${new URL(url).pathname}`); return Response.json({}); };
  await api.completePsychologistAppointment('t', 'a/1');
  await api.markPsychologistAppointmentNoShow('t', 'a/1');
  assert.deepEqual(seen, [
    'PATCH /appointments/psychologist/me/a%2F1/complete',
    'PATCH /appointments/psychologist/me/a%2F1/no-show',
  ]);
});

test('calendar dates are formatted in Spanish without shifting the day in any timezone', () => {
  for (const tz of ['America/Bogota', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    process.env.TZ = tz;
    assert.equal(appt.formatCalendarDate('2026-10-14'), 'miércoles, 14 de octubre de 2026', tz);
    assert.equal(appt.formatCalendarDate('2026-10-19'), 'lunes, 19 de octubre de 2026', tz);
  }
  assert.equal(appt.formatCalendarDate('2026-02-30'), '2026-02-30');
});

test('times are shown as es-CO 12-hour clock', () => {
  assert.equal(plain(appt.formatClockTime(480)), '8:00 a. m.');
  assert.equal(plain(appt.formatClockTime(780)), '1:00 p. m.');
  assert.equal(plain(appt.formatClockTime('10:00')), '10:00 a. m.');
  assert.equal(plain(appt.formatTimeRange('10:00', '11:00')), '10:00 a. m. – 11:00 a. m.');
});

test('business "now" is computed in America/Bogota regardless of the browser timezone', () => {
  process.env.TZ = 'Asia/Tokyo';
  assert.deepEqual(appt.businessNow(new Date('2026-10-14T20:00:00Z')), NOW);
  assert.deepEqual(appt.businessNow(new Date('2026-10-15T04:30:00Z')), { date: '2026-10-14', minute: 23 * 60 + 30 });
});

test('Upcoming vs History classification', () => {
  const A = item('A', '2026-10-15', '10:00', 'SCHEDULED');
  const B = item('B', '2026-09-28', '08:00', 'SCHEDULED');
  const C = item('C', '2026-10-01', '09:00', 'COMPLETED');
  const D = item('D', '2026-10-08', '09:00', 'NO_SHOW');
  const E = item('E', '2026-10-20', '09:00', 'CANCELLED');
  const { upcoming, history } = appt.splitAppointments([B, E, A, C, D], NOW);
  assert.deepEqual(upcoming.map((x) => x.id), ['A']);
  assert.deepEqual(history.map((x) => x.id), ['E', 'D', 'C', 'B']); // most recent first
  assert.equal(appt.displayStatus(B, NOW), 'PAST_SCHEDULED');
  assert.equal(appt.STATUS_LABEL[appt.displayStatus(B, NOW)], 'Pendiente de cierre');
  assert.equal(appt.STATUS_LABEL[appt.displayStatus(C, NOW)], 'Realizada');
  assert.equal(appt.STATUS_LABEL[appt.displayStatus(D, NOW)], 'Inasistencia');
  assert.equal(appt.STATUS_LABEL[appt.displayStatus(E, NOW)], 'Cancelada');
  assert.equal(appt.STATUS_LABEL[appt.displayStatus(A, NOW)], 'Programada');
});

test('today: a session that ended is history, one in progress is still upcoming', () => {
  const ended = item('x', '2026-10-14', '13:00', 'SCHEDULED'); // 13–14
  const inProgress = item('y', '2026-10-14', '14:30', 'SCHEDULED'); // 14:30–15:30
  const later = item('z', '2026-10-14', '16:00', 'SCHEDULED');
  const { upcoming, history } = appt.splitAppointments([ended, inProgress, later], NOW);
  assert.deepEqual(upcoming.map((x) => x.id), ['y', 'z']);
  assert.deepEqual(history.map((x) => x.id), ['x']);
  assert.equal(appt.displayStatus(inProgress, NOW), 'IN_PROGRESS');
});

test('patient may cancel/reschedule only a future SCHEDULED appointment', () => {
  assert.equal(appt.canPatientModify(item('A', '2026-10-15', '10:00', 'SCHEDULED'), NOW), true);
  assert.equal(appt.canPatientModify(item('B', '2026-09-28', '08:00', 'SCHEDULED'), NOW), false);
  assert.equal(appt.canPatientModify(item('i', '2026-10-14', '14:30', 'SCHEDULED'), NOW), false);
  for (const status of ['COMPLETED', 'NO_SHOW', 'CANCELLED'])
    assert.equal(appt.canPatientModify(item('s', '2026-10-15', '10:00', status), NOW), false, status);
});

test('psychologist may close only a SCHEDULED appointment that already ended', () => {
  assert.equal(appt.canPsychologistClose(item('B', '2026-09-28', '08:00', 'SCHEDULED'), NOW), true);
  assert.equal(appt.canPsychologistClose(item('A', '2026-10-15', '10:00', 'SCHEDULED'), NOW), false);
  assert.equal(appt.canPsychologistClose(item('i', '2026-10-14', '14:30', 'SCHEDULED'), NOW), false);
  assert.equal(appt.canPsychologistClose(item('C', '2026-10-01', '09:00', 'COMPLETED'), NOW), false);
});

test('error messages are accurate for each HTTP case', () => {
  const err = (status, message = '') => new api.ApiError(status, message);
  assert.equal(appt.appointmentErrorMessage(err(409), 'book'), 'El horario dejó de estar disponible. Selecciona otro.');
  assert.equal(appt.appointmentErrorMessage(err(400, 'No puedes agendar una cita en una fecha u hora pasada.'), 'book'),
    'No puedes agendar una cita en una fecha u hora pasada.');
  assert.equal(appt.appointmentErrorMessage(err(400, 'No puedes agendar una cita en una fecha u hora pasada.'), 'reschedule'),
    'No puedes reagendar una cita a una fecha u hora pasada.');
  assert.equal(appt.appointmentErrorMessage(err(404), 'slots'), 'El psicólogo seleccionado ya no está disponible.');
  assert.match(appt.appointmentErrorMessage(err(401), 'book'), /sesión/);
  assert.match(appt.appointmentErrorMessage(err(403), 'book'), /permiso/);
  assert.equal(appt.NO_SLOTS_MESSAGE, 'No hay horarios disponibles para esta fecha.');
});
