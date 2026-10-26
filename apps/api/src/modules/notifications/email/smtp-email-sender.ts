import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { SmtpConfig } from '../notifications-config';
import {
  EmailDeliveryError,
  type EmailSender,
  type OutgoingEmail,
} from './email-sender';

const TRANSIENT_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPROTOCOL',
  'EAUTH', // usually a configuration problem: retry later instead of dropping mail
]);

export function smtpTransportOptions(
  config: SmtpConfig,
): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure, // 465: TLS from the first byte
    requireTLS: !config.secure, // 587: STARTTLS is mandatory, never plain text
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: 'TLSv1.2', servername: config.host },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // Messages are built from our own templates: no file or URL fetching, no debug logs.
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}

export function classifySmtpError(error: unknown): EmailDeliveryError {
  const candidate = error as { responseCode?: unknown; code?: unknown };
  const responseCode =
    typeof candidate?.responseCode === 'number' ? candidate.responseCode : null;
  const code = typeof candidate?.code === 'string' ? candidate.code : null;
  if (responseCode !== null) {
    // 4xx = temporary (greylisting, mailbox busy); 5xx = permanent (bad address, rejected).
    return new EmailDeliveryError(`SMTP_${responseCode}`, responseCode < 500);
  }
  if (code === 'EENVELOPE')
    return new EmailDeliveryError('INVALID_RECIPIENT', false);
  if (code === 'EMESSAGE')
    return new EmailDeliveryError('INVALID_MESSAGE', false);
  if (code && TRANSIENT_CODES.has(code))
    return new EmailDeliveryError(code, true);
  return new EmailDeliveryError('SMTP_UNKNOWN', true);
}

type TransportFactory = typeof createTransport;

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(
    private readonly config: SmtpConfig,
    factory: TransportFactory = createTransport,
  ) {
    this.transporter = factory(smtpTransportOptions(config));
  }

  async send(email: OutgoingEmail): Promise<{ messageId: string | null }> {
    try {
      const info = await this.transporter.sendMail({
        from: { name: this.config.fromName, address: this.config.from },
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      return {
        messageId: typeof info.messageId === 'string' ? info.messageId : null,
      };
    } catch (error: unknown) {
      throw classifySmtpError(error);
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (error: unknown) {
      throw classifySmtpError(error);
    }
  }

  close(): void {
    this.transporter.close();
  }
}
