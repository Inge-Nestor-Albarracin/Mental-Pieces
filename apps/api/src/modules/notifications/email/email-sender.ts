// Provider-neutral contract: business rules depend on this, not on Nodemailer, so the
// SMTP provider (Hostinger today) can be replaced without touching them.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  // Resolves when the provider ACCEPTED the message (not proof of inbox delivery).
  send(email: OutgoingEmail): Promise<{ messageId: string | null }>;
  // Checks connectivity and authentication without sending anything.
  verify(): Promise<void>;
  close(): void;
}

// code: sanitized identifier (e.g. SMTP_550, ETIMEDOUT). Never the server's message text.
export class EmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly transient: boolean,
  ) {
    super(code);
    this.name = 'EmailDeliveryError';
  }
}
