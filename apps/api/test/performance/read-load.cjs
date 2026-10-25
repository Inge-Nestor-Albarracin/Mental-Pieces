// Bounded, READ-ONLY load test for a LOCAL API connected to a disposable database.
// - Refuses non-local targets (there is no switch to aim it at Supabase/Hostinger).
// - Never exceeds the API's own per-route limit (120 req/min/IP): rate-capped ladder.
// - Never prints tokens, headers or response bodies; only aggregated numbers.
// Usage (see README.md): PERF_FIXTURES=... PERF_JWT_SECRET=... [PERF_API_PID=...] node test/performance/read-load.cjs
const { createHmac } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');

const BASE = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3941';
const host = new URL(BASE).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('Refusing to load-test a non-local target. Remote runs need explicit authorization and a separate plan.');
}
const fixtures = JSON.parse(readFileSync(process.env.PERF_FIXTURES, 'utf8'));
const SECRET = process.env.PERF_JWT_SECRET;
if (!SECRET) throw new Error('PERF_JWT_SECRET is required (the local test API secret).');
const API_PID = process.env.PERF_API_PID ? Number(process.env.PERF_API_PID) : null;
const LEVELS = (process.env.PERF_LEVELS ?? '1,5,10,25').split(',').map(Number);
const LEVEL_SECONDS = Number(process.env.PERF_LEVEL_SECONDS ?? 20);
const RATE = Number(process.env.PERF_RATE ?? 1.6); // requests/second per route, < 120/min
const BURSTS = (process.env.PERF_BURSTS ?? '5,10,25').split(',').map(Number);

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(sub, role) {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, email: `${sub}@example.test`, iat: now, exp: now + 900 })}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}

const patients = fixtures.patients.map((id) => sign(id, 'PATIENT'));
const psychologists = fixtures.psychologists.map((id) => sign(id, 'PSYCHOLOGIST'));
const futureDate = (n) => new Date(Date.now() - 5 * 3600e3 + (2 + (n % 20)) * 86400e3).toISOString().slice(0, 10);
let counter = 0;
const pick = (list) => list[counter++ % list.length];

const SCENARIOS = [
  { name: 'A available-slots', path: () => `/appointments/available-slots?psychologistId=${pick(fixtures.psychologists)}&date=${futureDate(counter)}`, token: () => pick(patients) },
  { name: 'B patient agenda', path: () => '/appointments/me', token: () => pick(patients) },
  { name: 'C psychologist agenda', path: () => '/appointments/psychologist/me', token: () => pick(psychologists) },
  { name: 'D clinical patients', path: () => '/clinical/patients', token: () => pick(psychologists) },
  { name: 'E auth/me', path: () => '/auth/me', token: () => pick(patients) },
  { name: 'F psychologist alerts', path: () => '/clinical/alerts', token: () => pick(psychologists), rate: 0.3, bursts: [5, 10] },
];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function sampleProcess() {
  if (!API_PID) return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${API_PID}; "$($p.CPU);$($p.WorkingSet64)"`], { encoding: 'utf8' }).trim();
    const [cpu, ws] = out.split(';').map(Number);
    return { cpuSeconds: cpu, rssMB: Math.round(ws / 1048576) };
  } catch {
    return null;
  }
}

async function call(scenario) {
  const started = performance.now();
  try {
    const response = await fetch(BASE + scenario.path(), {
      headers: { Authorization: `Bearer ${scenario.token()}` },
      signal: AbortSignal.timeout(10_000),
    });
    await response.arrayBuffer();
    return { status: response.status, ms: performance.now() - started };
  } catch {
    return { status: 0, ms: performance.now() - started }; // timeout / network error
  }
}

function summarize(scenario, phase, vus, results, seconds, before, after) {
  const ms = results.map((r) => r.ms);
  const by = (test) => results.filter((r) => test(r.status)).length;
  const cpu = before && after ? Math.round(((after.cpuSeconds - before.cpuSeconds) / seconds) * 100) : null;
  return {
    scenario: scenario.name, phase, vus, seconds: Math.round(seconds * 10) / 10,
    requests: results.length, ratePerSec: Math.round((results.length / seconds) * 100) / 100,
    p50: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), p99: Math.round(percentile(ms, 99)), max: Math.round(Math.max(0, ...ms)),
    s2xx: by((s) => s >= 200 && s < 300), s401: by((s) => s === 401), s403: by((s) => s === 403), s404: by((s) => s === 404),
    s409: by((s) => s === 409), s429: by((s) => s === 429), s5xx: by((s) => s >= 500), timeouts: by((s) => s === 0),
    cpuPctOneCore: cpu, rssMB: after?.rssMB ?? null,
  };
}

// Fixed arrival rate, at most `vus` requests in flight.
async function ladderLevel(scenario, vus) {
  const rate = scenario.rate ?? RATE;
  const results = [];
  const inFlight = new Set();
  const before = sampleProcess();
  const started = performance.now();
  const total = Math.max(1, Math.round(rate * LEVEL_SECONDS));
  let maxInFlight = 0;
  for (let i = 0; i < total; i++) {
    const due = started + (i / rate) * 1000;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    while (inFlight.size >= vus) await Promise.race(inFlight);
    const p = call(scenario).then((r) => { results.push(r); inFlight.delete(p); });
    inFlight.add(p);
    maxInFlight = Math.max(maxInFlight, inFlight.size);
  }
  await Promise.all(inFlight);
  const seconds = (performance.now() - started) / 1000;
  return { ...summarize(scenario, 'ladder', vus, results, seconds, before, sampleProcess()), maxInFlight };
}

async function burst(scenario, size) {
  const before = sampleProcess();
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: size }, () => call(scenario)));
  const seconds = (performance.now() - started) / 1000;
  return { ...summarize(scenario, 'burst', size, results, seconds, before, sampleProcess()), maxInFlight: size };
}

(async () => {
  const rows = [];
  const machine = { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemGB: Math.round(os.totalmem() / 1073741824), node: process.version };
  console.log('machine', machine);
  for (const scenario of SCENARIOS) {
    for (const vus of LEVELS) {
      const row = await ladderLevel(scenario, vus);
      rows.push(row);
      console.log(JSON.stringify(row));
      const errorRate = row.s5xx / Math.max(1, row.requests);
      if (errorRate > 0.01 || row.p95 > 3000 || row.timeouts > 0) {
        console.log(`STOP ${scenario.name}: protection threshold reached`);
        break;
      }
    }
  }
  // Bursts run after every ladder, so each route's 60 s window has already reset.
  for (const scenario of SCENARIOS) {
    for (const size of scenario.bursts ?? BURSTS) {
      const row = await burst(scenario, size);
      rows.push(row);
      console.log(JSON.stringify(row));
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify({ machine, base: 'local', rows }, null, 2));
})();
