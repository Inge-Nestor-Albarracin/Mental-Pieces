import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

// Run the real API client with an in-memory HTTP substitute. No server or DB writes.
const source = await readFile(new URL('../lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function respond(body, status = 200, check = () => {}) {
  globalThis.fetch = async (url, options) => {
    check(new URL(url), options);
    return Response.json(body, { status });
  };
}

test('auth/me supplies the role without another login or client-supplied identity', async () => {
  const user = { id: 'test-user', email: 'test@example.invalid', role: 'PSYCHOLOGIST' };
  respond(user, 200, (url, options) => {
    assert.equal(url.pathname, '/auth/me');
    assert.equal(url.search, '');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer test-session');
  });
  assert.deepEqual(await api.getCurrentUser('test-session'), user);
});

test('own availability uses /me and preserves the empty state', async () => {
  respond([], 200, (url) => {
    assert.equal(url.pathname, '/availability/me');
    assert.equal(url.search, '');
  });
  assert.deepEqual(await api.getMyAvailability('test-session'), []);
});

test('creation sends only day and times even if the caller supplies extra fields', async () => {
  const payload = { dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '12:00' };
  const block = { id: 'test-block', ...payload, isActive: true };
  respond(block, 201, (url, options) => {
    assert.equal(url.pathname, '/availability/me');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), payload);
  });
  assert.deepEqual(await api.createMyAvailability('test-session', {
    ...payload, psychologistId: 'untrusted-id', isActive: false,
  }), block);
});

test('deletion uses the own-resource path, encodes the id and sends no body', async () => {
  respond({ message: 'Eliminado.' }, 200, (url, options) => {
    assert.equal(url.pathname, '/availability/me/test%2Fblock');
    assert.equal(options.method, 'DELETE');
    assert.equal(options.body, undefined);
  });
  assert.equal(await api.deleteMyAvailability('test-session', 'test/block'), undefined);
});

test('agenda has no psychologistId query and accepts nullable patient names', async () => {
  const appointments = [{
    id: 'test-appointment', appointmentDate: '2026-10-05', startTime: '09:00', endTime: '10:00',
    status: 'SCHEDULED', patient: { id: 'test-patient', fullName: null },
  }];
  respond(appointments, 200, (url) => {
    assert.equal(url.pathname, '/appointments/psychologist/me');
    assert.equal(url.search, '');
  });
  assert.deepEqual(await api.getPsychologistAppointments('test-session'), appointments);
});

for (const status of [400, 401, 403, 404, 409]) {
  test(`HTTP ${status} remains distinguishable to the UI`, async () => {
    respond({ message: ['Primer detalle.', 'Segundo detalle.'] }, status);
    await assert.rejects(api.getMyAvailability('test-session'), (error) => {
      assert.ok(error instanceof api.ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, 'Primer detalle. Segundo detalle.');
      return true;
    });
  });
}

test('server errors hide internal details', async () => {
  respond({ message: 'Internal diagnostic detail' }, 500);
  await assert.rejects(api.getPsychologistAppointments('test-session'), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, 'No fue posible cargar tu agenda.');
    return true;
  });
});

test('non-JSON errors keep their HTTP status and a useful fallback', async () => {
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  await assert.rejects(api.getMyAvailability('test-session'), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, 'No fue posible cargar tu disponibilidad.');
    return true;
  });
});

test('network failures reject instead of producing an empty agenda', async () => {
  globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
  await assert.rejects(api.getPsychologistAppointments('test-session'), TypeError);
});
