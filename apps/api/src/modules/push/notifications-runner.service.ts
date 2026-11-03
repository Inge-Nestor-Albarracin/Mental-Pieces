import { Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { SmtpEmailSender } from '../notifications/email/smtp-email-sender';
import { NotificationProcessor } from '../notifications/notification-processor';
import {
  loadNotificationsConfig,
  loadSmtpConfig,
  NotificationsConfigError,
} from '../notifications/notifications-config';
import { PushDispatcher } from './push-dispatcher';

// Hostinger cron jobs do NOT receive the web app's environment variables, so the CLI
// started by cron saw NOTIFICATIONS_ENABLED unset and never sent anything. The cron
// instead calls POST /internal/notifications/run (curl) and the queue is processed
// here, inside the API process that already has DATABASE_URL, SMTP_* and VAPID_*.
//
//   NOTIFICATIONS_CRON_SECRET=<32+ random characters>   (unset = endpoint disabled)

const MIN_SECRET_LENGTH = 32;

export type RunTrigger =
  | { status: 'disabled' }
  | { status: 'unauthorized' }
  | { status: 'started' }
  | { status: 'running' };

@Injectable()
export class NotificationsRunnerService {
  private readonly logger = new Logger('NotificationsRunner');
  private readonly secret: Buffer | null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushDispatcher,
  ) {
    const raw = process.env.NOTIFICATIONS_CRON_SECRET?.trim() ?? '';
    this.secret = raw.length >= MIN_SECRET_LENGTH ? Buffer.from(raw) : null;
    if (raw && !this.secret)
      this.logger.error(
        `NOTIFICATIONS_CRON_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres. Ejecución por HTTP desactivada.`,
      );
  }

  // Returns immediately; the run continues in the background (bounded by the
  // processors' own time budgets), so the cron's HTTP call never times out.
  trigger(presented: string | undefined): RunTrigger {
    if (!this.secret) return { status: 'disabled' };
    const candidate = Buffer.from(presented ?? '');
    if (
      candidate.length !== this.secret.length ||
      !timingSafeEqual(candidate, this.secret)
    )
      return { status: 'unauthorized' };
    this.push.kick();
    if (this.running) return { status: 'running' };
    this.running = true;
    setImmediate(() => void this.runEmail());
    return { status: 'started' };
  }

  private async runEmail(): Promise<void> {
    try {
      const config = loadNotificationsConfig();
      if (!config.enabled) {
        this.logger.log('email disabled (NOTIFICATIONS_ENABLED is not true)');
        return;
      }
      const sender = new SmtpEmailSender(loadSmtpConfig());
      try {
        const summary = await new NotificationProcessor(
          this.prisma,
          sender,
          config,
        ).runOnce();
        this.logger.log(`email run ${JSON.stringify(summary)}`);
      } finally {
        sender.close();
      }
    } catch (error: unknown) {
      // Variable names or sanitized codes only, never values or addresses.
      if (error instanceof NotificationsConfigError)
        this.logger.error(error.message);
      else
        this.logger.warn(
          `email run failed: ${(error as { name?: string })?.name ?? 'Error'} ${(error as { code?: string })?.code ?? ''}`.trim(),
        );
    } finally {
      this.running = false;
    }
  }
}
