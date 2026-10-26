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

test('service worker caches only static files, never pages or API data', async () => {
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  // Cross-origin requests (the API) are ignored; only GET is considered.
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(sw, /if \(request\.method !== 'GET'\) return;/);
  // Navigations are network-only with an offline fallback: page HTML is never stored.
  assert.match(sw, /request\.mode === 'navigate'[\s\S]{0,120}fetch\(request\)\.catch\(\(\) => caches\.match\(OFFLINE_URL\)\)/);
  const cacheable = /function isCacheableStatic\(url\) \{([\s\S]*?)\}/.exec(sw)?.[1] ?? '';
  assert.match(cacheable, /\/_next\/static\//);
  assert.doesNotMatch(cacheable, /api|appointments|clinical|patients|profile/i);
  await stat(new URL('../public/offline.html', import.meta.url));
});

test('service worker behaviour: offline fallback for pages, cache for static, API untouched', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listeners = {};
  const store = new Map();
  const cache = {
    addAll: async (urls) => urls.forEach((u) => store.set(u, `precached ${u}`)),
    put: async (request, response) => store.set(new URL(request.url).pathname, response),
    match: async (request) => store.get(typeof request === 'string' ? request : new URL(request.url).pathname),
  };
  const self = {
    location: { origin: 'https://mentalpieces.site' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  let online = true;
  const network = [];
  const fakeFetch = async (request) => {
    network.push(request.url);
    if (!online) throw new TypeError('offline');
    return { ok: true, clone: () => 'copy', body: `network ${request.url}` };
  };
  const caches = { open: async () => cache, keys: async () => [], match: (r) => cache.match(r), delete: async () => true };
  new Function('self', 'caches', 'fetch', source)(self, caches, fakeFetch);
  await new Promise((resolve) => listeners.install({ waitUntil: (p) => p.then(resolve) }));

  async function dispatch(url, { mode = 'cors', method = 'GET' } = {}) {
    let responded = null;
    listeners.fetch({ request: { url, mode, method }, respondWith: (p) => { responded = p; } });
    return responded ? await responded : 'not intercepted';
  }

  assert.equal(await dispatch('https://api.mentalpieces.site/appointments/me'), 'not intercepted');
  assert.equal(await dispatch('https://mentalpieces.site/login', { method: 'POST' }), 'not intercepted');
  assert.equal(await dispatch('https://mentalpieces.site/manifest.webmanifest'), 'not intercepted');

  online = false;
  assert.equal(await dispatch('https://mentalpieces.site/dashboard', { mode: 'navigate' }), 'precached /offline.html');
  assert.ok(!store.has('/dashboard'), 'page HTML must never be cached');

  online = true;
  await dispatch('https://mentalpieces.site/_next/static/chunks/app.js');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(store.has('/_next/static/chunks/app.js'));
  assert.deepEqual([...store.keys()].filter((k) => !k.startsWith('/_next/static/') && !k.startsWith('/icons/') && k !== '/offline.html'), []);
});
