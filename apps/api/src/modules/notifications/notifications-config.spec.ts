import {
  isAllowedRecipient,
  loadNotificationsConfig,
  loadSmtpConfig,
  maskEmail,
  NotificationsConfigError,
  parseAllowlist,
} from './notifications-config';

const SECRET = 'valor-secreto-de-prueba';
const smtpEnv = {
  SMTP_HOST: 'smtp.hostinger.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'notificaciones@mentalpieces.site',
  SMTP_PASSWORD: SECRET,
  SMTP_FROM: 'notificaciones@mentalpieces.site',
};

describe('notifications configuration', () => {
  it('is disabled by default and sends to nobody without an allowlist', () => {
    const config = loadNotificationsConfig({});
    expect(config.enabled).toBe(false);
    expect(config.recipientAllowlist).toEqual([]);
    expect(
      isAllowedRecipient('a@example.test', config.recipientAllowlist),
    ).toBe(false);
    expect(config.appUrl).toBe('https://mentalpieces.site');
  });

  it('accepts the Hostinger SMTP settings (465 + TLS)', () => {
    expect(loadSmtpConfig(smtpEnv)).toMatchObject({
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      fromName: 'Mental Pieces',
    });
  });

  it('fails safely when credentials are missing, naming variables but never values', () => {
    const attempt = () =>
      loadSmtpConfig({
        ...smtpEnv,
        SMTP_PASSWORD: '',
        SMTP_USER: 'no-es-correo',
      });
    expect(attempt).toThrow(NotificationsConfigError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SMTP_PASSWORD');
      expect(message).toContain('SMTP_USER');
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('no-es-correo');
    }
  });

  it('rejects port 465 without TLS and allows 587 only as mandatory STARTTLS', () => {
    expect(() => loadSmtpConfig({ ...smtpEnv, SMTP_SECURE: 'false' })).toThrow(
      /SMTP_SECURE/,
    );
    expect(
      loadSmtpConfig({ ...smtpEnv, SMTP_PORT: '587', SMTP_SECURE: 'false' }),
    ).toMatchObject({
      port: 587,
      secure: false,
    });
  });

  it('validates limits, time zone and lease', () => {
    expect(() =>
      loadNotificationsConfig({ NOTIFICATIONS_ENABLED: 'yes' }),
    ).toThrow(/NOTIFICATIONS_ENABLED/);
    expect(() =>
      loadNotificationsConfig({ NOTIFICATIONS_TIMEZONE: 'UTC' }),
    ).toThrow(/NOTIFICATIONS_TIMEZONE/);
    expect(() =>
      loadNotificationsConfig({ NOTIFICATIONS_BATCH_SIZE: '100000' }),
    ).toThrow(/NOTIFICATIONS_BATCH_SIZE/);
    expect(() =>
      loadNotificationsConfig({
        NOTIFICATIONS_LEASE_MINUTES: '5',
        NOTIFICATIONS_MAX_RUNTIME_SECONDS: '600',
      }),
    ).toThrow(/NOTIFICATIONS_LEASE_MINUTES/);
    expect(() =>
      loadNotificationsConfig({ APP_PUBLIC_URL: 'http://evil.example' }),
    ).toThrow(/APP_PUBLIC_URL/);
  });

  it('allowlist supports "*", exact addresses and @domain entries', () => {
    expect(parseAllowlist('*')).toBe('*');
    const list = parseAllowlist(' Prueba@Gmail.com , @example.test ');
    expect(isAllowedRecipient('prueba@gmail.com', list)).toBe(true);
    expect(isAllowedRecipient('alguien@example.test', list)).toBe(true);
    expect(isAllowedRecipient('otro@gmail.com', list)).toBe(false);
    expect(isAllowedRecipient('x@example.test.evil.com', list)).toBe(false);
  });

  it('masks addresses for logs', () => {
    expect(maskEmail('paciente@example.test')).toBe('p***@example.test');
  });
});
