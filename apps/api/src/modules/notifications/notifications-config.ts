import { BUSINESS_TIMEZONE } from './notification-time';

// Configuration comes only from private environment variables (never the frontend).
// Errors name the offending variables but never print their values.

export class NotificationsConfigError extends Error {
  constructor(readonly invalidKeys: string[]) {
    super(
      `Configuración de notificaciones incompleta o inválida: ${invalidKeys.join(', ')}`,
    );
    this.name = 'NotificationsConfigError';
  }
}

export interface NotificationsConfig {
  enabled: boolean;
  // '*' = any recipient; otherwise exact addresses or '@domain' entries. Empty = nobody.
  recipientAllowlist: '*' | string[];
  batchSize: number;
  dailyLimit: number;
  perRecipientDailyLimit: number;
  maxAttempts: number;
  maxRuntimeMs: number;
  leaseMs: number;
  // Confirmations, changes and cancellations older than this are dropped, not sent late.
  maxDelayMs: number;
  appUrl: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  fromName: string;
}

type Env = Record<string, string | undefined>;

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function integer(
  env: Env,
  key: string,
  fallback: number,
  min: number,
  max: number,
  invalid: string[],
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid.push(key);
    return fallback;
  }
  return value;
}

function bool(
  env: Env,
  key: string,
  fallback: boolean,
  invalid: string[],
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  invalid.push(key);
  return fallback;
}

export function parseAllowlist(raw: string | undefined): '*' | string[] {
  const value = raw?.trim() ?? '';
  if (value === '*') return '*';
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedRecipient(
  email: string,
  allowlist: '*' | string[],
): boolean {
  if (allowlist === '*') return true;
  const address = email.trim().toLowerCase();
  return allowlist.some((entry) =>
    entry.startsWith('@') ? address.endsWith(entry) : address === entry,
  );
}

export function loadNotificationsConfig(
  env: Env = process.env,
): NotificationsConfig {
  const invalid: string[] = [];
  const timezone = env.NOTIFICATIONS_TIMEZONE?.trim();
  if (timezone && timezone !== BUSINESS_TIMEZONE)
    invalid.push('NOTIFICATIONS_TIMEZONE');

  const appUrl = (
    env.APP_PUBLIC_URL?.trim() || 'https://mentalpieces.site'
  ).replace(/\/+$/, '');
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')
      invalid.push('APP_PUBLIC_URL');
  } catch {
    invalid.push('APP_PUBLIC_URL');
  }

  const config: NotificationsConfig = {
    enabled: bool(env, 'NOTIFICATIONS_ENABLED', false, invalid),
    recipientAllowlist: parseAllowlist(env.NOTIFICATIONS_RECIPIENT_ALLOWLIST),
    batchSize: integer(env, 'NOTIFICATIONS_BATCH_SIZE', 20, 1, 100, invalid),
    dailyLimit: integer(env, 'NOTIFICATIONS_DAILY_LIMIT', 80, 1, 5000, invalid),
    perRecipientDailyLimit: integer(
      env,
      'NOTIFICATIONS_PER_RECIPIENT_DAILY_LIMIT',
      10,
      1,
      100,
      invalid,
    ),
    maxAttempts: integer(env, 'NOTIFICATIONS_MAX_ATTEMPTS', 4, 1, 10, invalid),
    maxRuntimeMs:
      integer(
        env,
        'NOTIFICATIONS_MAX_RUNTIME_SECONDS',
        240,
        10,
        1200,
        invalid,
      ) * 1000,
    leaseMs:
      integer(env, 'NOTIFICATIONS_LEASE_MINUTES', 15, 5, 120, invalid) *
      60 *
      1000,
    maxDelayMs:
      integer(env, 'NOTIFICATIONS_MAX_DELAY_HOURS', 24, 1, 168, invalid) *
      60 *
      60 *
      1000,
    appUrl,
  };
  // The lease must outlive a whole run, or an in-flight message could be claimed twice.
  if (config.leaseMs <= config.maxRuntimeMs)
    invalid.push('NOTIFICATIONS_LEASE_MINUTES');
  if (invalid.length) throw new NotificationsConfigError(invalid);
  return config;
}

export function loadSmtpConfig(env: Env = process.env): SmtpConfig {
  const invalid: string[] = [];
  const host = env.SMTP_HOST?.trim() ?? '';
  const user = env.SMTP_USER?.trim() ?? '';
  const password = env.SMTP_PASSWORD ?? '';
  const from = env.SMTP_FROM?.trim() ?? '';
  if (!host) invalid.push('SMTP_HOST');
  if (!EMAIL_PATTERN.test(user)) invalid.push('SMTP_USER');
  if (!password) invalid.push('SMTP_PASSWORD');
  if (!EMAIL_PATTERN.test(from)) invalid.push('SMTP_FROM');
  const port = integer(env, 'SMTP_PORT', 465, 1, 65535, invalid);
  const secure = bool(env, 'SMTP_SECURE', true, invalid);
  // 465 = implicit TLS (secure=true). Otherwise STARTTLS is mandatory (requireTLS);
  // certificate verification is never disabled.
  if (port === 465 && !secure) invalid.push('SMTP_SECURE');
  if (invalid.length) throw new NotificationsConfigError([...new Set(invalid)]);
  return {
    host,
    port,
    secure,
    user,
    password,
    from,
    fromName: env.SMTP_FROM_NAME?.trim() || 'Mental Pieces',
  };
}

// a***@gmail.com — for logs and CLI output; full addresses are never logged.
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}
