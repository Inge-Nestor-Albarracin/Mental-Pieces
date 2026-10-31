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
const keys = await load('../lib/push-keys.ts');
const navigation = await load('../lib/navigation.ts');
const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('VAPID key decoding and subscription key encoding round-trip (base64url, no padding)', () => {
  const bytes = Uint8Array.from({ length: 65 }, (_, index) => (index * 37 + 251) % 256);
  const encoded = keys.arrayBufferToBase64Url(bytes.buffer);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(encoded.length, 87);
  assert.deepEqual([...keys.urlBase64ToUint8Array(encoded)], [...bytes]);
  assert.equal(keys.arrayBufferToBase64Url(null), '');
});

test('staff has its own portal: home, menu and label', () => {
  assert.equal(navigation.homeHref('STAFF'), '/staff/dashboard');
  assert.deepEqual(navigation.NAV_LINKS.STAFF.map(([href]) => href), ['/staff/dashboard', '/staff/appointments/new']);
  assert.equal(navigation.ROLE_LABEL.STAFF, 'Recepción');
});

test('role gate routes staff to its portal instead of blocking it', async () => {
  const gate = await source('../components/role-gate.tsx');
  assert.match(gate, /role === 'STAFF' \? '\/staff\/dashboard'/);
  assert.doesNotMatch(gate, /Sin acceso a este portal/);
});

test('every portal shows the notification prompt (patient, psychologist, admin, staff)', async () => {
  const shell = await source('../components/app-shell.tsx');
  assert.match(shell, /<PushPrompt \/>/);
  for (const layout of ['../app/staff/layout.tsx', '../app/admin/layout.tsx', '../app/psychologist/layout.tsx']) {
    assert.match(await source(layout), /<AppShell role=/, layout);
  }
});

test('permission is requested only from a click, never on page load', async () => {
  const prompt = await source('../components/push-notifications.tsx');
  const push = await source('../lib/push.ts');
  assert.doesNotMatch(prompt, /requestPermission/);
  assert.match(push, /export async function enablePush[\s\S]*Notification\.requestPermission\(\)/);
  assert.match(prompt, /onClick=\{\(\) => void enable\(\)\}/);
});

test('logout removes this device’s subscription before dropping the token', async () => {
  const header = await source('../components/app-header.tsx');
  const logout = header.slice(header.indexOf('async function logout'));
  assert.ok(logout.indexOf('disablePushForLogout') < logout.indexOf("sessionStorage.removeItem('accessToken')"));
});

test('service worker shows pushes and only opens same-origin paths', async () => {
  const worker = await source('../public/sw.js');
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(worker, /data\.url\.startsWith\('\/'\) && !data\.url\.startsWith\('\/\/'\)/);
  assert.match(worker, /target\.origin !== self\.location\.origin/);
  // Push payloads are displayed, never cached.
  const pushHandler = worker.slice(worker.indexOf("addEventListener('push'"));
  assert.doesNotMatch(pushHandler, /caches\.open|cache\.put/);
});

test('reception pages use the staff-desk API and never clinical endpoints', async () => {
  for (const page of ['../app/staff/dashboard/page.tsx', '../app/staff/appointments/new/page.tsx']) {
    const text = await source(page);
    assert.doesNotMatch(text, /Clinical|clinical/, page);
  }
  const api = await source('../lib/api.ts');
  assert.match(api, /'\/staff-desk\/appointments'/);
  assert.match(api, /`\/staff-desk\/agenda\?/);
  assert.match(api, /`\/staff-desk\/patients\?/);
});
