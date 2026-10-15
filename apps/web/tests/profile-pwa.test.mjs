import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const profile = await load('../lib/profile.ts');
const manifest = (await load('../app/manifest.ts')).default();
const originalTz = process.env.TZ;
afterEach(() => { process.env.TZ = originalTz; });

test('gender is shown with a readable Spanish label, never the raw enum', () => {
  assert.equal(profile.genderLabel('FEMALE', null), 'Femenino');
  assert.equal(profile.genderLabel('PREFER_NOT_TO_SAY', null), 'Prefiero no especificarlo');
  assert.equal(profile.genderLabel('OTHER', '  Género fluido '), 'Género fluido');
  assert.equal(profile.genderLabel('OTHER', null), 'Otro');
  assert.equal(profile.genderLabel(null, null), null);
});

test('birth date is a calendar date: same day in any timezone', () => {
  for (const tz of ['America/Bogota', 'UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati']) {
    process.env.TZ = tz;
    assert.equal(profile.formatBirthDate('1990-10-14T00:00:00.000Z'), '14 de octubre de 1990', tz);
  }
  assert.equal(profile.birthDateInput('1990-10-14T00:00:00.000Z'), '1990-10-14');
  assert.equal(profile.formatBirthDate(null), null);
  assert.equal(profile.firstName('  Paula  Sarmiento'), 'Paula');
  assert.equal(profile.firstName(null), 'paciente');
});

test('profile page offers a way back to the patient home', async () => {
  const source = await readFile(new URL('../app/profile/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /<BackLink href="\/dashboard">Volver al inicio<\/BackLink>/);
});

test('every portal uses the shell with header and footer', async () => {
  const shell = await readFile(new URL('../components/app-shell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /<AppFooter/);
  for (const layout of ['dashboard', 'appointments', 'profile', 'psychologist', 'admin']) {
    const source = await readFile(new URL(`../app/${layout}/layout.tsx`, import.meta.url), 'utf8');
    assert.match(source, /<RoleGate role="(PATIENT|PSYCHOLOGIST|ADMIN)">/, layout);
    assert.match(source, /<AppShell role=/, layout);
  }
});

test('PWA manifest is installable and its icons exist', async () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'es-CO');
  assert.equal(manifest.start_url, '/login');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.ok((await stat(new URL(`../public${icon.src}`, import.meta.url))).size > 0, icon.src);
});

test('no service worker caches personal or clinical data', async () => {
  await assert.rejects(stat(new URL('../public/sw.js', import.meta.url)));
});
