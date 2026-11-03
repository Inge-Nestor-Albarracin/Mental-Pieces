import type { ConnectionOptions } from 'node:tls';

// TLS for the PostgreSQL connection. Supabase also accepts plaintext connections, and
// node-postgres does NOT use TLS unless told to: without this, credentials and clinical
// data travelled unencrypted between Hostinger and Supabase.
//
//   - local hosts (tests, disposable databases): no TLS;
//   - remote + DATABASE_SSL_CA (Supabase "SSL certificate", PEM): TLS with full
//     certificate verification (protects against interception and impersonation);
//   - remote without it: TLS without certificate verification (encrypted; Supabase's
//     pooler certificate is signed by Supabase's own CA, not a public one).
// sslmode in the URL is ignored: the explicit `ssl` option below is authoritative.

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface DatabaseConnection {
  connectionString: string;
  ssl: false | ConnectionOptions;
  verified: boolean;
}

export function databaseConnection(
  url: string,
  env: Record<string, string | undefined> = process.env,
): DatabaseConnection {
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl'])
    parsed.searchParams.delete(key);
  const connectionString = parsed.toString();

  if (LOCAL_HOSTS.has(parsed.hostname))
    return { connectionString, ssl: false, verified: false };

  // Hosting panels store multi-line values poorly: accept literal "\n" escapes.
  const ca = env.DATABASE_SSL_CA?.trim().replace(/\\n/g, '\n');
  if (ca && ca.includes('-----BEGIN CERTIFICATE-----'))
    return {
      connectionString,
      ssl: { ca, rejectUnauthorized: true },
      verified: true,
    };
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    verified: false,
  };
}
