import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const onboarding = await load('../lib/onboarding.ts');
const profile = await load('../lib/profile.ts');
const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const NEW = { dataPolicyAccepted: true, isProfileComplete: false };
const READY = { dataPolicyAccepted: true, isProfileComplete: true };
const NO_POLICY = { dataPolicyAccepted: false, isProfileComplete: true };
const NOTHING = { dataPolicyAccepted: false, isProfileComplete: false };

test('after login: policy first, then profile, then the dashboard', () => {
  assert.equal(onboarding.patientLanding(NEW), '/profile/edit?onboarding=1');
  assert.equal(onboarding.patientLanding(READY), '/dashboard');
  assert.equal(onboarding.patientLanding(NO_POLICY), '/autorizacion-de-datos');
  assert.equal(onboarding.patientLanding(NOTHING), '/autorizacion-de-datos');
});

test('direct URLs are redirected to the pending step (dashboard, booking, reload)', () => {
  for (const path of ['/dashboard', '/appointments/new', '/appointments', '/profile']) {
    assert.equal(onboarding.patientRedirect(path, NEW), '/profile/edit?onboarding=1', path);
    assert.equal(onboarding.patientRedirect(path, NO_POLICY), '/autorizacion-de-datos', path);
    assert.equal(onboarding.patientRedirect(path, READY), null, path);
  }
  assert.equal(onboarding.patientRedirect('/profile/edit', NEW), null);
  assert.equal(onboarding.patientRedirect('/profile/edit', READY), null);
  assert.equal(onboarding.patientRedirect('/autorizacion-de-datos', NO_POLICY), null);
  assert.equal(onboarding.patientRedirect('/autorizacion-de-datos', READY), '/dashboard');
  // Missing both: the authorisation is resolved before the profile.
  assert.equal(onboarding.patientRedirect('/profile/edit', NOTHING), '/autorizacion-de-datos');
});

test('no redirect loops: following any redirect lands on a page the same status allows', () => {
  const paths = ['/dashboard', '/appointments/new', '/appointments', '/profile', '/profile/edit', '/autorizacion-de-datos'];
  for (const status of [NEW, READY, NO_POLICY, NOTHING]) {
    for (const path of paths) {
      let current = path;
      for (let hop = 0; hop < 3; hop += 1) {
        const target = onboarding.patientRedirect(current, status);
        if (!target) break;
        current = target.split('?')[0];
      }
      assert.equal(onboarding.patientRedirect(current, status), null, `${JSON.stringify(status)} from ${path}`);
    }
  }
});

test('profile form: spaces, future dates and blank phones are refused; PREFER_NOT_TO_SAY is valid', () => {
  const today = '2026-10-28';
  const valid = { fullName: 'Ana Pérez', birthDate: '1990-05-01', gender: 'PREFER_NOT_TO_SAY', genderOther: '', phone: '300 123 4567' };
  assert.equal(profile.profileFormIssue(valid, today), null);
  assert.match(profile.profileFormIssue({ ...valid, fullName: '    ' }, today), /nombre/);
  assert.match(profile.profileFormIssue({ ...valid, birthDate: '2026-10-29' }, today), /futuro/);
  assert.match(profile.profileFormIssue({ ...valid, birthDate: '' }, today), /fecha/);
  assert.match(profile.profileFormIssue({ ...valid, phone: '        ' }, today), /teléfono/);
  assert.match(profile.profileFormIssue({ ...valid, gender: '' }, today), /género/);
  assert.match(profile.profileFormIssue({ ...valid, gender: 'OTHER', genderOther: '  ' }, today), /identificas/);
  assert.equal(profile.profileFormIssue({ ...valid, gender: 'OTHER', genderOther: 'Género fluido' }, today), null);
});

test('minors are detected on the business date (booking is not enabled for them yet)', () => {
  assert.equal(profile.isUnderage('2008-10-28', '2026-10-28'), false);
  assert.equal(profile.isUnderage('2008-10-29', '2026-10-28'), true);
  assert.equal(profile.isUnderage('', '2026-10-28'), false);
});

test('sign-up: unchecked authorisation, policy link in a new tab, version sent to the API', async () => {
  const register = await source('../app/register/page.tsx');
  assert.match(register, /useState\(false\)[\s\S]*acceptDataPolicy|const \[acceptDataPolicy, setAcceptDataPolicy\] =\s*useState\(false\)/);
  assert.doesNotMatch(register, /defaultChecked|checked=\{true\}/);
  assert.match(register, /href=\{DATA_POLICY_PATH\}\s*target="_blank"\s*rel="noopener noreferrer"/);
  assert.match(register, /dataPolicyVersion: policy\.version/);
  assert.match(register, /Autorización de tratamiento de datos personales/);
  assert.equal(onboarding.DATA_POLICY_PATH, '/politica-de-tratamiento-de-datos');
});

test('the profile form in onboarding mode explains why and trusts only the server flag', async () => {
  const edit = await source('../app/profile/edit/page.tsx');
  assert.match(edit, /Completa tu perfil/);
  assert.match(edit, /Antes de agendar tu primera cita, necesitamos que completes tus datos personales\./);
  assert.match(edit, /if \(!saved\.isProfileComplete\)/);
  assert.match(edit, /¡Tu perfil está completo!/);
});

test('only patients go through the onboarding gate', async () => {
  const gate = await source('../components/role-gate.tsx');
  assert.match(gate, /if \(role === 'PATIENT'\)/);
  const login = await source('../app/login/page.tsx');
  assert.match(login, /result\.user\.role === 'PATIENT'/);
});
