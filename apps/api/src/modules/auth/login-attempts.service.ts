import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
// Bounded so the tracker itself cannot be used to exhaust memory.
const MAX_TRACKED_ACCOUNTS = 10_000;

interface Attempts {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export const LOCKED_MESSAGE =
  'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';

// Per-account brute-force protection. Keyed by normalized email whether or not the
// account exists, so the lock never reveals which emails are registered.
// In-memory: per API instance (see docs/security.md for multi-instance deployments).
@Injectable()
export class LoginAttemptsService {
  private readonly attempts = new Map<string, Attempts>();

  // Overridable clock for tests.
  protected now(): number {
    return Date.now();
  }

  private key(email: string): string {
    return email.trim().toLowerCase();
  }

  assertNotLocked(email: string): void {
    const entry = this.attempts.get(this.key(email));
    if (entry && entry.lockedUntil > this.now()) {
      throw new HttpException(LOCKED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(email: string): void {
    const key = this.key(email);
    const now = this.now();
    let entry = this.attempts.get(key);
    if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
      entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    }
    entry.failures += 1;
    if (entry.failures >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = 0;
      entry.firstFailureAt = now;
    }
    this.attempts.delete(key); // re-insert to keep insertion order = recency
    this.attempts.set(key, entry);
    this.evict(now);
  }

  recordSuccess(email: string): void {
    this.attempts.delete(this.key(email));
  }

  private evict(now: number): void {
    if (this.attempts.size <= MAX_TRACKED_ACCOUNTS) return;
    for (const [key, entry] of this.attempts) {
      if (this.attempts.size <= MAX_TRACKED_ACCOUNTS) break;
      if (entry.lockedUntil <= now) this.attempts.delete(key);
    }
    // Still full of active locks: drop the oldest entries.
    for (const key of this.attempts.keys()) {
      if (this.attempts.size <= MAX_TRACKED_ACCOUNTS) break;
      this.attempts.delete(key);
    }
  }
}
