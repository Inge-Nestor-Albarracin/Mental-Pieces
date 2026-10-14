import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

// Run the real API client and clinical helpers with an in-memory HTTP substitute. No server or DB.
async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const api = await load('../lib/api.ts');
const clinical = await load('../lib/clinical.ts');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function respond(body, status = 200, check = () => {}) {
  globalThis.fetch = async (url, options) => {
    check(new URL(url), options);
    return Response.json(body, { status });
  };
}

const patientId = 'cpatient000000000000000001';
const appointmentId = 'cappointment00000000000001';
const page = (items) => ({ items, page: 1, pageSize: 20, hasMore: false });

test('assigned patients: own list, page query only, no identity parameters', async () => {
  respond(page([{ id: patientId, fullName: 'Psicólogo de Prueba' }]), 200, (url, options) => {
    assert.equal(url.pathname, '/clinical/patients');
    assert.equal(url.search, '?page=1');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer test-session');
  });
  const result = await api.getClinicalPatients('test-session');
  assert.equal(result.items[0].fullName, 'Psicólogo de Prueba');
});

test('notes: patientId only in the encoded path', async () => {
  respond(page([]), 200, (url) => {
    assert.equal(url.pathname, '/clinical/patients/a%2Fb/notes');
    assert.equal(url.search, '?page=2');
  });
  await api.getClinicalNotes('test-session', 'a/b', 2);
});

test('create note sends only content when no appointment is selected', async () => {
  respond({ id: 'n1' }, 201, (url, options) => {
    assert.equal(url.pathname, `/clinical/patients/${patientId}/notes`);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { content: 'Texto sintético con tildes: sesión, contraseña.' });
  });
  await api.createClinicalNote('test-session', patientId, {
    content: 'Texto sintético con tildes: sesión, contraseña.',
    // Untrusted extras must never reach the body.
    patientId: 'untrusted', psychologistId: 'untrusted', authorId: 'untrusted', role: 'ADMIN', status: 'X',
  });
});

test('create note includes appointmentId only when selected', async () => {
  respond({ id: 'n1' }, 201, (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { content: 'Nota', appointmentId });
  });
  await api.createClinicalNote('test-session', patientId, { content: 'Nota', appointmentId });
  respond({ id: 'n2' }, 201, (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { content: 'Nota' });
  });
  await api.createClinicalNote('test-session', patientId, { content: 'Nota', appointmentId: '' });
});

test('request body is real UTF-8 JSON, not escaped or re-encoded', async () => {
  respond({ id: 'n1' }, 201, (_url, options) => {
    assert.equal(options.headers['Content-Type'], 'application/json');
    const bytes = Buffer.from(options.body, 'utf8').toString('hex');
    assert.ok(bytes.includes('c3b3'), 'ó must travel as UTF-8 bytes C3 B3');
    assert.ok(!options.body.includes('\\u00f3'));
  });
  await api.createClinicalNote('test-session', patientId, { content: 'Psicólogo' });
});

test('admin assignment creation sends exactly patientId and psychologistId', async () => {
  respond({ id: 'r1' }, 201, (url, options) => {
    assert.equal(url.pathname, '/clinical/assignments');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { patientId, psychologistId: 'cpsy' });
  });
  await api.createCareAssignment('test-session', { patientId, psychologistId: 'cpsy', isActive: true, actorUserId: 'x' });
});

test('admin end assignment uses PATCH on the encoded id with no body', async () => {
  respond({ id: 'r1' }, 200, (url, options) => {
    assert.equal(url.pathname, '/clinical/assignments/r%2F1/end');
    assert.equal(options.method, 'PATCH');
    assert.equal(options.body, undefined);
  });
  await api.endCareAssignment('test-session', 'r/1');
});

test('admin lookups hit the minimized endpoints, never /users', async () => {
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(new URL(url).pathname); return Response.json(page([])); };
  await api.getAssignablePatients('test-session');
  await api.getCareAssignments('test-session');
  globalThis.fetch = async (url) => { seen.push(new URL(url).pathname); return Response.json([]); };
  await api.getPsychologists('test-session');
  assert.deepEqual(seen, ['/clinical/admin/patients', '/clinical/assignments', '/staff/psychologists']);
});

for (const status of [401, 403, 404, 409]) {
  test(`clinical HTTP ${status} keeps its status for the UI`, async () => {
    respond({ message: 'Recurso clínico no encontrado.' }, status);
    await assert.rejects(api.getClinicalNotes('test-session', patientId), (error) => {
      assert.ok(error instanceof api.ApiError);
      assert.equal(error.status, status);
      return true;
    });
  });
}

test('401/403/404 revoke the clinical view; 409/400/500 do not', () => {
  const err = (status) => new api.ApiError(status, 'x');
  for (const status of [401, 403, 404]) assert.equal(clinical.revokesClinicalAccess(err(status)), true);
  for (const status of [400, 409, 500]) assert.equal(clinical.revokesClinicalAccess(err(status)), false);
  assert.equal(clinical.revokesClinicalAccess(new TypeError('network')), false);
});

test('note errors: 409 is the duplicate-appointment message, 404 stays generic', () => {
  assert.equal(clinical.noteErrorMessage(new api.ApiError(409, 'Ya existe una nota clínica principal para esta cita.')),
    'Esta cita ya tiene una nota clínica asociada.');
  const notFound = clinical.noteErrorMessage(new api.ApiError(404, 'Paciente pertenece a otro psicólogo'));
  assert.equal(notFound, 'No fue posible acceder al recurso clínico.');
  assert.equal(clinical.noteErrorMessage(new api.ApiError(500, 'internal')), 'No fue posible guardar la nota clínica. Intenta de nuevo.');
});

test('assignment errors explain 409 without promising reactivation', () => {
  assert.match(clinical.assignmentErrorMessage(new api.ApiError(409, 'x'), 'create'), /ya existe/);
  assert.match(clinical.assignmentErrorMessage(new api.ApiError(409, 'x'), 'end'), /ya estaba finalizada/);
});

test('only COMPLETED appointments of the same patient are selectable, newest first', () => {
  const appt = (id, status, pid, date, start = '09:00') => ({
    id, status, appointmentDate: date, startTime: start, endTime: '10:00', patient: { id: pid, fullName: null },
  });
  const result = clinical.completedAppointmentsFor([
    appt('a', 'COMPLETED', patientId, '2026-09-01'),
    appt('b', 'NO_SHOW', patientId, '2026-09-02'),
    appt('c', 'SCHEDULED', patientId, '2026-09-03'),
    appt('d', 'CANCELLED', patientId, '2026-09-04'),
    appt('e', 'COMPLETED', 'cotherpatient', '2026-09-05'),
    appt('f', 'COMPLETED', patientId, '2026-09-06'),
  ], patientId);
  assert.deepEqual(result.map((item) => item.id), ['f', 'a']);
});

test('the clinical API client never logs or persists clinical data', async () => {
  for (const file of ['../lib/api.ts', '../lib/clinical.ts', '../app/psychologist/patients/[patientId]/page.tsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.|localStorage|indexedDB|sessionStorage\.setItem/, file);
  }
});

test('admin UI never links to or imports clinical notes', async () => {
  for (const file of ['../app/admin/clinical-assignments/page.tsx', '../app/admin/dashboard/page.tsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /notes|getClinicalNotes|createClinicalNote|psychologist\/patients/, file);
  }
});
