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
const alerts = await load('../lib/care-alerts.ts');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const rules = { noFirstSessionDays: 14, inactiveDays: 30, highSeverityDays: 60, noShowStreak: 2 };
const emptyPage = { items: [], page: 1, pageSize: 50, hasMore: false, total: 0, truncated: false, rules, generatedAt: '2026-10-14T15:00:00Z' };

test('psychologist alerts use the own endpoint with no identity parameters', async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/clinical/alerts');
    assert.equal(parsed.search, '?page=1');
    assert.equal(options.cache, 'no-store');
    return Response.json(emptyPage);
  };
  assert.equal((await api.getMyCareAlerts('test-session')).total, 0);
});

test('admin alerts use the admin endpoint', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/clinical/admin/alerts');
    return Response.json(emptyPage);
  };
  await api.getAdminCareAlerts('test-session', 1);
});

test('alert 403 keeps its status for the UI', async () => {
  globalThis.fetch = async () => Response.json({ message: 'No tienes permisos.' }, { status: 403 });
  await assert.rejects(api.getAdminCareAlerts('test-session'), (error) => error.status === 403);
});

test('reason labels explain the rule with real numbers and Spanish accents', () => {
  const alert = {
    relationshipId: 'r', patient: { id: 'p', fullName: null }, level: 'HIGH',
    reasons: ['NO_SHOW_STREAK', 'INACTIVE'], lastSessionDate: '2026-08-01',
    daysSinceLastSession: 74, daysSinceAssigned: 200, noShowsSinceLastSession: 3, nextAppointmentDate: null,
  };
  assert.equal(alerts.reasonLabel('NO_SHOW_STREAK', alert, rules), '3 inasistencias desde la última sesión (umbral: 2).');
  assert.equal(alerts.reasonLabel('INACTIVE', alert, rules), '74 días sin sesión y sin próxima cita (umbral: 30).');
  assert.match(alerts.reasonLabel('NO_FIRST_SESSION', alert, rules), /200 días/);
  assert.equal(alerts.LEVEL_LABEL.HIGH, 'Prioridad alta');
});

test('admin alerts page never links to clinical notes', async () => {
  const source = await readFile(new URL('../app/admin/alerts/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /patientHref|notes|psychologist\/patients/);
});
