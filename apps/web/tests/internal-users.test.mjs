import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

// Real API client and helpers with an in-memory HTTP substitute. No server or DB.
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replace(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
// Both modules share one api.ts instance, so ApiError instanceof checks hold.
const apiUrl = await moduleUrl('../lib/api.ts');
const api = await import(apiUrl);
const users = await import(await moduleUrl('../lib/internal-users.ts', { "from './api'": `from '${apiUrl}'` }));
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// Synthetic test value, not a real credential.
const syntheticPassword = 'clave-sintetica-123';
const validForm = {
  role: 'PSYCHOLOGIST',
  fullName: '  Psicóloga Sintética ',
  email: ' Nueva@Example.Invalid ',
  password: syntheticPassword,
  confirmPassword: syntheticPassword,
  phone: '',
  position: '',
};

test('list: GET /staff with page query and the session token only', async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/staff');
    assert.equal(parsed.search, '?page=2');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    return Response.json({ items: [], page: 2, pageSize: 20, hasMore: false });
  };
  const result = await api.getInternalUsers('test-session', 2);
  assert.equal(result.page, 2);
});

test('create: POST /staff sends only the allowed fields', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/staff');
    assert.equal(options.method, 'POST');
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['email', 'fullName', 'password', 'role']);
    return Response.json({ id: 'u1', role: 'PSYCHOLOGIST' }, { status: 201 });
  };
  await api.createInternalUser('test-session', users.toCreatePayload(validForm));
});

test('create: a 409 keeps its status so the screen can explain it', async () => {
  globalThis.fetch = async () => Response.json({ message: 'duplicado' }, { status: 409 });
  await assert.rejects(api.createInternalUser('test-session', users.toCreatePayload(validForm)), (error) => {
    assert.equal(error.status, 409);
    return true;
  });
});

test('payload is trimmed, email lower-cased, empty optional fields omitted', () => {
  assert.deepEqual(users.toCreatePayload(validForm), {
    role: 'PSYCHOLOGIST',
    fullName: 'Psicóloga Sintética',
    email: 'nueva@example.invalid',
    password: syntheticPassword,
  });
  assert.deepEqual(users.toCreatePayload({ ...validForm, phone: ' 3001234567 ', position: ' Recepción ' }), {
    role: 'PSYCHOLOGIST',
    fullName: 'Psicóloga Sintética',
    email: 'nueva@example.invalid',
    password: syntheticPassword,
    phone: '3001234567',
    position: 'Recepción',
  });
});

test('validation mirrors the API limits', () => {
  assert.equal(users.validateInternalUser(validForm), null);
  for (const [patch, fragment] of [
    [{ role: '' }, 'psicólogo o de staff'],
    [{ fullName: '   ' }, 'nombre completo'],
    [{ email: 'no-es-correo' }, 'correo'],
    [{ password: 'corta', confirmPassword: 'corta' }, '8 caracteres'],
    [{ confirmPassword: 'otra-clave-123' }, 'no coinciden'],
    [{ phone: '123' }, 'teléfono'],
    [{ position: 'x'.repeat(101) }, 'cargo'],
  ]) {
    assert.match(users.validateInternalUser({ ...validForm, ...patch }) ?? '', new RegExp(fragment, 'i'));
  }
});

test('only psychologist and staff can be chosen (never ADMIN or PATIENT)', () => {
  assert.deepEqual(users.INTERNAL_ROLE_OPTIONS.map((option) => option.value), ['PSYCHOLOGIST', 'STAFF']);
});

test('error messages are friendly and specific', () => {
  assert.match(users.internalUserErrorMessage(new api.ApiError(409, 'x')), /Ya existe una cuenta/);
  assert.match(users.internalUserErrorMessage(new api.ApiError(429, 'x')), /demasiadas cuentas/);
  assert.equal(users.internalUserErrorMessage(new api.ApiError(400, 'El correo electrónico no es válido.')), 'El correo electrónico no es válido.');
  assert.match(users.internalUserErrorMessage(new Error('boom')), /No fue posible crear/);
});

test('admin navigation and dashboard link to the new module', async () => {
  assert.match(await read('../lib/navigation.ts'), /\['\/admin\/users', 'Usuarios'\]/);
  assert.match(await read('../app/admin/dashboard/page.tsx'), /href="\/admin\/users"/);
  const page = await read('../app/admin/users/page.tsx');
  // The initial password is cleared after creating the account and never stored in the browser.
  assert.match(page, /setForm\(EMPTY_INTERNAL_USER_FORM\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage\.setItem|console\./);
});
