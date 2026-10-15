import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('every appointment status has its own colour, so states are easy to tell apart', async () => {
  const source = await read('../components/appointment-tabs.tsx');
  const block = /STATUS_TONE[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  const tones = [...block.matchAll(/(\w+): '(\w+)'/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(tones.map(([status]) => status).sort(),
    ['CANCELLED', 'COMPLETED', 'IN_PROGRESS', 'NO_SHOW', 'PAST_SCHEDULED', 'SCHEDULED']);
  assert.equal(new Set(tones.map(([, tone]) => tone)).size, tones.length, 'tones must be unique');
});

test('patient reschedule and cancel are large, labelled and visually different', async () => {
  const source = await read('../app/appointments/page.tsx');
  assert.match(source, /className="btn btn-primary min-h-14[^"]*">\s*<Icon name="repeat"[^>]*\/> Reagendar cita/);
  assert.match(source, /className="btn btn-danger min-h-14[^"]*">\s*<Icon name="x"[^>]*\/> Cancelar cita/);
  // Destructive action always asks for confirmation first.
  assert.match(source, /Sí, cancelar cita/);
});

test('psychologist closing actions are large and distinct', async () => {
  const source = await read('../app/psychologist/appointments/page.tsx');
  assert.match(source, /btn btn-primary min-h-14[^"]*"[\s\S]{0,120}Marcar realizada/);
  assert.match(source, /border-amber-400[\s\S]{0,200}Marcar inasistencia/);
});

test('all roles use the redesigned building blocks', async () => {
  for (const [file, marker] of [
    ['../app/dashboard/page.tsx', '<Hero'],
    ['../app/psychologist/dashboard/page.tsx', '<Hero'],
    ['../app/admin/dashboard/page.tsx', '<Hero'],
    ['../app/psychologist/appointments/page.tsx', '<AppointmentCard'],
    ['../app/psychologist/availability/page.tsx', '<PageIntro'],
    ['../app/psychologist/patients/page.tsx', '<PageIntro'],
    ['../app/admin/clinical-assignments/page.tsx', '<PageIntro'],
    ['../components/care-alerts-view.tsx', '<PageIntro'],
  ]) {
    assert.ok((await read(file)).includes(marker), `${file} should use ${marker}`);
  }
});

test('the existing logo is kept everywhere (no redrawn brand mark)', async () => {
  for (const file of ['../components/app-header.tsx', '../components/app-footer.tsx']) {
    const source = await read(file);
    assert.match(source, /src="\/icons\/wordmark\.png"/, file);
    assert.doesNotMatch(source, /piece-one|brand-mark/, file);
  }
});

test('primary buttons use the deep forest green (AA contrast with white text)', async () => {
  const css = await read('../app/globals.css');
  assert.match(css, /--forest: #365b45;/);
  assert.match(css, /\.btn-primary \{\s*@apply bg-forest text-white/);
});
