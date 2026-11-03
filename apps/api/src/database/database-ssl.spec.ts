import { databaseConnection } from './database-ssl';

const CA =
  '-----BEGIN CERTIFICATE-----\nMIIBsynthetic\n-----END CERTIFICATE-----';

describe('databaseConnection (TLS to PostgreSQL)', () => {
  const remote =
    'postgresql://u:p@aws-1-us-east-1.pooler.supabase.com:5432/postgres';

  it('always encrypts a remote database, even without sslmode in the URL', () => {
    expect(databaseConnection(remote, {})).toMatchObject({
      ssl: { rejectUnauthorized: false },
      verified: false,
    });
  });

  it('verifies the certificate when the Supabase CA is configured', () => {
    expect(databaseConnection(remote, { DATABASE_SSL_CA: CA })).toMatchObject({
      ssl: { ca: CA, rejectUnauthorized: true },
      verified: true,
    });
  });

  it('accepts the CA with escaped newlines (hosting panels)', () => {
    const escaped = CA.replace(/\n/g, '\n');
    expect(
      databaseConnection(remote, { DATABASE_SSL_CA: escaped }).ssl,
    ).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
  });

  it('cannot be downgraded with sslmode=disable in the URL', () => {
    const result = databaseConnection(`${remote}?sslmode=disable`, {});
    expect(result.connectionString).not.toContain('sslmode');
    expect(result.ssl).not.toBe(false);
  });

  it('keeps local disposable databases without TLS', () => {
    expect(
      databaseConnection(
        'postgresql://u:p@127.0.0.1:55432/mental_pieces_test',
        {},
      ).ssl,
    ).toBe(false);
  });
});
