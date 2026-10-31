import * as webpush from 'web-push';
import type { PushConfig } from './push-config';

// Provider-neutral contract (like EmailSender): business rules depend on this, not on
// the web-push library, so tests use a fake and nothing real is sent.

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  // Same-origin path the notification opens when tapped.
  url: string;
  // Same tag = the newer notification replaces the older one on the device.
  tag: string;
}

export interface PushSender {
  // Resolves when the push service ACCEPTED the message (not proof it was displayed).
  send(target: PushTarget, message: PushMessage): Promise<void>;
}

// code: sanitized identifier (e.g. PUSH_410, ETIMEDOUT). Never the service's response body.
// gone: the subscription no longer exists (404/410) and must be deleted.
export class PushDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly transient: boolean,
    readonly gone = false,
  ) {
    super(code);
    this.name = 'PushDeliveryError';
  }
}

export function classifyPushFailure(error: unknown): PushDeliveryError {
  if (error instanceof PushDeliveryError) return error;
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  if (typeof statusCode === 'number') {
    if (statusCode === 404 || statusCode === 410)
      return new PushDeliveryError(`PUSH_${statusCode}`, false, true);
    return new PushDeliveryError(
      `PUSH_${statusCode}`,
      statusCode === 429 || statusCode >= 500,
    );
  }
  const code = (error as { code?: unknown })?.code;
  return new PushDeliveryError(
    typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)
      ? code
      : 'PUSH_ERROR',
    true,
  );
}

const SEND_TIMEOUT_MS = 10_000;

export class WebPushSender implements PushSender {
  constructor(private readonly config: PushConfig) {}

  async send(target: PushTarget, message: PushMessage): Promise<void> {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
          TTL: this.config.ttlSeconds,
          urgency: 'high',
          topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
          timeout: SEND_TIMEOUT_MS,
        },
      );
    } catch (error: unknown) {
      throw classifyPushFailure(error);
    }
  }
}
