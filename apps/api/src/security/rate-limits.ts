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
  // Booking, rescheduling and cancelling.
  appointmentWrite: { ttl: 60 * MINUTE, limit: 30 },
  // Expensive aggregate reads (alerts evaluate every active relationship).
  heavyRead: { ttl: MINUTE, limit: 20 },
} as const;

export function throttle(rule: { ttl: number; limit: number }) {
  return { default: rule };
}
