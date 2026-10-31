// Request limits per client IP (see ThrottlerModule in AppModule).
// In-memory storage: valid for a single API instance. With several instances or
// serverless, move the storage to a shared store (e.g. Redis) — see docs/security.md.

const MINUTE = 60_000;

export const RATE_LIMITS = {
  // Every route unless it declares a stricter limit.
  default: { ttl: MINUTE, limit: 120 },
  // Credential guessing: per IP, on top of the per-account lockout.
  login: { ttl: 15 * MINUTE, limit: 20 },
  // Account creation (bcrypt cost 12 per request, spam accounts).
  register: { ttl: 60 * MINUTE, limit: 5 },
  // Admin creating psychologist/staff accounts (bcrypt cost 12 per request).
  staffCreate: { ttl: 60 * MINUTE, limit: 30 },
  // Booking, rescheduling and cancelling.
  appointmentWrite: { ttl: 60 * MINUTE, limit: 30 },
  // Expensive aggregate reads (alerts evaluate every active relationship).
  heavyRead: { ttl: MINUTE, limit: 20 },
  // Registering / removing this device's push subscription (login, logout, refresh).
  pushSubscription: { ttl: 60 * MINUTE, limit: 30 },
  // "Send me a test notification": real requests to the browser's push service.
  pushTest: { ttl: 60 * MINUTE, limit: 5 },
  // Reception searching patients by name, MRN, email or phone.
  patientSearch: { ttl: MINUTE, limit: 40 },
} as const;

export function throttle(rule: { ttl: number; limit: number }) {
  return { default: rule };
}
