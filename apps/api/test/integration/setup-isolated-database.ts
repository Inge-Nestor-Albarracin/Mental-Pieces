// Runs before every integration test file (jest "setupFiles").
// Integration tests write to a REAL PostgreSQL. They only run against an explicitly
// provided, local, disposable database and never fall back to DATABASE_URL from .env.
import { randomBytes } from 'node:crypto';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const raw = process.env.INTEGRATION_DATABASE_URL;
if (!raw) {
  throw new Error(
    'INTEGRATION_DATABASE_URL is not set. Integration tests need a local, disposable ' +
      'PostgreSQL (see docs/audits). They never use DATABASE_URL.',
  );
}

const url = new URL(raw);
const databaseName = url.pathname.replace(/^\//, '');
if (!LOCAL_HOSTS.has(url.hostname) || !/test/i.test(databaseName)) {
  throw new Error(
    'Refusing to run: INTEGRATION_DATABASE_URL must point to a local host and a ' +
      'database whose name contains "test".',
  );
}

// Set before any application import, so dotenv/ConfigModule cannot load .env values.
process.env.DATABASE_URL = raw;
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.TZ = process.env.TZ ?? 'UTC';
