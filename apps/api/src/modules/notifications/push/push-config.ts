import { NotificationsConfigError } from '../notifications-config';

// Web Push (VAPID) configuration, from private environment variables only. The public
// key is handed to browsers; the private key never leaves the server and is never logged.
//
//   PUSH_ENABLED=true
//   VAPID_PUBLIC_KEY=...        (base64url, from `npx web-push generate-vapid-keys`)
//   VAPID_PRIVATE_KEY=...
//   VAPID_SUBJECT=mailto:...    (contact the push services can reach)

export interface PushConfig {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  subject: string;
  // Seconds a push service keeps an undelivered message (device offline).
  ttlSeconds: number;
  batchSize: number;
  maxAttempts: number;
  maxRuntimeMs: number;
  leaseMs: number;
  // Confirmations, changes and alerts older than this are dropped, not pushed late.
  maxDelayMs: number;
}

type Env = Record<string, string | undefined>;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const PUSH_DISABLED: PushConfig = {
  enabled: false,
  publicKey: '',
  privateKey: '',
  subject: '',
  ttlSeconds: 0,
  batchSize: 0,
  maxAttempts: 0,
  maxRuntimeMs: 0,
  leaseMs: 0,
  maxDelayMs: 0,
};

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

// Push stays off (and the app hides the permission prompt) unless PUSH_ENABLED=true.
// With it on, missing or malformed keys are a configuration error, not a silent no-op.
export function loadPushConfig(env: Env = process.env): PushConfig {
  const flag = env.PUSH_ENABLED?.trim().toLowerCase();
  if (!flag || flag === 'false') return PUSH_DISABLED;
  const invalid: string[] = [];
  if (flag !== 'true') invalid.push('PUSH_ENABLED');

  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = env.VAPID_SUBJECT?.trim() ?? '';
  // P-256 keys: 65-byte public key (87 chars) and 32-byte private key (43 chars).
  if (!BASE64URL.test(publicKey) || publicKey.length !== 87)
    invalid.push('VAPID_PUBLIC_KEY');
  if (!BASE64URL.test(privateKey) || privateKey.length !== 43)
    invalid.push('VAPID_PRIVATE_KEY');
  if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/.test(subject))
    invalid.push('VAPID_SUBJECT');

  const config: PushConfig = {
    enabled: true,
    publicKey,
    privateKey,
    subject,
    ttlSeconds: integer(env, 'PUSH_TTL_HOURS', 12, 1, 72, invalid) * 60 * 60,
    batchSize: integer(env, 'PUSH_BATCH_SIZE', 50, 1, 200, invalid),
    maxAttempts: integer(env, 'PUSH_MAX_ATTEMPTS', 4, 1, 10, invalid),
    maxRuntimeMs:
      integer(env, 'PUSH_MAX_RUNTIME_SECONDS', 60, 5, 600, invalid) * 1000,
    leaseMs: integer(env, 'PUSH_LEASE_MINUTES', 10, 2, 60, invalid) * 60 * 1000,
    maxDelayMs:
      integer(env, 'PUSH_MAX_DELAY_HOURS', 12, 1, 72, invalid) * 60 * 60 * 1000,
  };
  if (config.leaseMs <= config.maxRuntimeMs) invalid.push('PUSH_LEASE_MINUTES');
  if (invalid.length) throw new NotificationsConfigError([...new Set(invalid)]);
  return config;
}
