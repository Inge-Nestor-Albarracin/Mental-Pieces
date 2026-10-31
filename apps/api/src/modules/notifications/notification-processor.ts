import {
  NotificationChannel,
  NotificationStatus,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../database/prisma.service';
import { EmailDeliveryError, type EmailSender } from './email/email-sender';
import { renderNotificationEmail } from './email/email-templates';
import { NotificationQueue } from './notification-queue';
import { decideDelivery, retryDelayMs } from './notification-rules';
import {
  isAllowedRecipient,
  type NotificationsConfig,
} from './notifications-config';

// One bounded run, started by cron: recover interrupted claims, claim a small batch
// atomically, send, record each result, exit. No timers, no infinite loop.

export interface RunSummary {
  enabled: boolean;
  recovered: number;
  claimed: number;
  accepted: number;
  retried: number;
  failed: number;
  skipped: number;
  released: number;
  quotaLeft: number;
  stoppedBy: 'done' | 'disabled' | 'daily_limit' | 'time_budget';
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Email channel only; push messages are processed by PushProcessor.
export class NotificationProcessor {
  private readonly queue: NotificationQueue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSender,
    private readonly config: NotificationsConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.queue = new NotificationQueue(
      prisma,
      NotificationChannel.EMAIL,
      clock,
    );
  }

  async runOnce(): Promise<RunSummary> {
    const summary: RunSummary = {
      enabled: this.config.enabled,
      recovered: 0,
      claimed: 0,
      accepted: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
      released: 0,
      quotaLeft: 0,
      stoppedBy: 'done',
    };
    // Kill switch: with sending disabled nothing is claimed, touched or sent.
    if (!this.config.enabled) return { ...summary, stoppedBy: 'disabled' };

    const started = Date.now();
    summary.recovered = await this.queue.recoverExpiredClaims(
      this.config.maxAttempts,
    );

    const sentToday = await this.queue.countAccepted(
      new Date(this.clock().getTime() - DAY_MS),
    );
    summary.quotaLeft = Math.max(0, this.config.dailyLimit - sentToday);
    if (summary.quotaLeft === 0)
      return { ...summary, stoppedBy: 'daily_limit' };

    const ids = await this.queue.claim(
      Math.min(this.config.batchSize, summary.quotaLeft),
      this.config.leaseMs,
    );
    summary.claimed = ids.length;

    for (let index = 0; index < ids.length; index++) {
      if (Date.now() - started > this.config.maxRuntimeMs) {
        summary.released = await this.queue.release(ids.slice(index));
        summary.stoppedBy = 'time_budget';
        break;
      }
      const outcome = await this.processOne(ids[index]);
      summary[outcome] += 1;
      if (outcome === 'accepted') summary.quotaLeft -= 1;
    }
    return summary;
  }

  private async processOne(
    id: string,
  ): Promise<'accepted' | 'retried' | 'failed' | 'skipped'> {
    const now = this.clock();
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      select: {
        type: true,
        recipientUserId: true,
        appointmentDate: true,
        startMinute: true,
        attempts: true,
        createdAt: true,
        appointment: {
          select: {
            status: true,
            appointmentDate: true,
            startMinute: true,
            endMinute: true,
            patient: {
              select: {
                userId: true,
                emailRemindersEnabled: true,
                user: { select: { email: true, isActive: true } },
              },
            },
            psychologist: {
              select: { id: true, email: true, isActive: true },
            },
          },
        },
      },
    });
    if (!notification) return 'skipped';

    const decision = decideDelivery(notification, now, this.config.maxDelayMs);
    if (!decision.send) {
      await this.queue.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: decision.reason,
      });
      return 'skipped';
    }
    if (!isAllowedRecipient(decision.email, this.config.recipientAllowlist)) {
      await this.queue.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: 'NOT_ALLOWLISTED',
      });
      return 'skipped';
    }
    // Abuse guard: bounded mail per person and day, whatever triggered it.
    const sentToRecipient = await this.queue.countAccepted(
      new Date(now.getTime() - DAY_MS),
      notification.recipientUserId,
    );
    const recipientLimit =
      decision.audience === 'PSYCHOLOGIST'
        ? this.config.psychologistDailyLimit
        : this.config.perRecipientDailyLimit;
    if (sentToRecipient >= recipientLimit) {
      await this.queue.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: 'RECIPIENT_DAILY_LIMIT',
      });
      return 'skipped';
    }

    const email = renderNotificationEmail({
      type: notification.type,
      appointmentDate: notification.appointmentDate,
      startMinute: notification.startMinute,
      endMinute: decision.endMinute,
      appUrl: this.config.appUrl,
      audience: decision.audience,
    });
    try {
      const { messageId } = await this.sender.send({
        to: decision.email,
        ...email,
      });
      await this.queue.finish(id, {
        status: NotificationStatus.ACCEPTED,
        acceptedAt: this.clock(),
        providerMessageId: messageId,
        errorCode: null,
      });
      return 'accepted';
    } catch (error: unknown) {
      const failure =
        error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError('SEND_ERROR', true);
      if (
        failure.transient &&
        notification.attempts < this.config.maxAttempts
      ) {
        await this.queue.finish(id, {
          status: NotificationStatus.PENDING,
          errorCode: failure.code,
          scheduledFor: new Date(
            this.clock().getTime() + retryDelayMs(notification.attempts),
          ),
        });
        return 'retried';
      }
      await this.queue.finish(id, {
        status: NotificationStatus.FAILED,
        errorCode: failure.code,
      });
      return 'failed';
    }
  }
}
