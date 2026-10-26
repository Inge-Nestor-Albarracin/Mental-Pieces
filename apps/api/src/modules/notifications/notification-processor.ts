import { Prisma } from '../../../generated/prisma/client';
import { NotificationStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../database/prisma.service';
import { EmailDeliveryError, type EmailSender } from './email/email-sender';
import { renderNotificationEmail } from './email/email-templates';
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

// Timestamps are stored as UTC in "timestamp without time zone": compare in UTC
// explicitly so the database session time zone can never shift the result.
const utc = (date: Date) =>
  Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export class NotificationProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSender,
    private readonly config: NotificationsConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
    summary.recovered = await this.recoverExpiredClaims();

    const sentToday = await this.prisma.notification.count({
      where: {
        status: NotificationStatus.ACCEPTED,
        acceptedAt: { gte: new Date(this.clock().getTime() - DAY_MS) },
      },
    });
    summary.quotaLeft = Math.max(0, this.config.dailyLimit - sentToday);
    if (summary.quotaLeft === 0)
      return { ...summary, stoppedBy: 'daily_limit' };

    const ids = await this.claim(
      Math.min(this.config.batchSize, summary.quotaLeft),
    );
    summary.claimed = ids.length;

    for (let index = 0; index < ids.length; index++) {
      if (Date.now() - started > this.config.maxRuntimeMs) {
        summary.released = await this.release(ids.slice(index));
        summary.stoppedBy = 'time_budget';
        break;
      }
      const outcome = await this.processOne(ids[index]);
      summary[outcome] += 1;
      if (outcome === 'accepted') summary.quotaLeft -= 1;
    }
    return summary;
  }

  // Atomic claim: FOR UPDATE SKIP LOCKED lets two simultaneous runs take disjoint rows.
  private async claim(limit: number): Promise<string[]> {
    const now = this.clock();
    const leaseUntil = new Date(now.getTime() + this.config.leaseMs);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Notification"
      SET status = 'PROCESSING',
          "lockedUntil" = ${utc(leaseUntil)},
          attempts = attempts + 1,
          "lastAttemptAt" = ${utc(now)},
          "updatedAt" = ${utc(now)}
      WHERE id IN (
        SELECT id FROM "Notification"
        WHERE status = 'PENDING' AND "scheduledFor" <= ${utc(now)}
        ORDER BY "scheduledFor" ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows.map((row) => row.id);
  }

  // A claim whose lease expired belongs to an interrupted run (killed cron, crash).
  private async recoverExpiredClaims(): Promise<number> {
    const now = this.clock();
    const expired = {
      status: NotificationStatus.PROCESSING,
      lockedUntil: { lt: now },
    };
    const exhausted = await this.prisma.notification.updateMany({
      where: { ...expired, attempts: { gte: this.config.maxAttempts } },
      data: {
        status: NotificationStatus.FAILED,
        errorCode: 'LEASE_EXPIRED',
        lockedUntil: null,
      },
    });
    const retried = await this.prisma.notification.updateMany({
      where: expired,
      data: {
        status: NotificationStatus.PENDING,
        lockedUntil: null,
        scheduledFor: now,
      },
    });
    return exhausted.count + retried.count;
  }

  // Claimed but not attempted (time budget reached): back to the queue, attempt not counted.
  private async release(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, status: NotificationStatus.PROCESSING },
      data: {
        status: NotificationStatus.PENDING,
        lockedUntil: null,
        attempts: { decrement: 1 },
      },
    });
    return result.count;
  }

  private async finish(
    id: string,
    data: Prisma.NotificationUpdateManyMutationInput,
  ) {
    await this.prisma.notification.updateMany({
      where: { id, status: NotificationStatus.PROCESSING },
      data: { ...data, lockedUntil: null },
    });
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
          },
        },
      },
    });
    if (!notification) return 'skipped';

    const decision = decideDelivery(notification, now, this.config.maxDelayMs);
    if (!decision.send) {
      await this.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: decision.reason,
      });
      return 'skipped';
    }
    if (!isAllowedRecipient(decision.email, this.config.recipientAllowlist)) {
      await this.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: 'NOT_ALLOWLISTED',
      });
      return 'skipped';
    }
    // Abuse guard: bounded mail per person and day, whatever triggered it.
    const sentToRecipient = await this.prisma.notification.count({
      where: {
        recipientUserId: notification.recipientUserId,
        status: NotificationStatus.ACCEPTED,
        acceptedAt: { gte: new Date(now.getTime() - DAY_MS) },
      },
    });
    if (sentToRecipient >= this.config.perRecipientDailyLimit) {
      await this.finish(id, {
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
    });
    try {
      const { messageId } = await this.sender.send({
        to: decision.email,
        ...email,
      });
      await this.finish(id, {
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
        await this.finish(id, {
          status: NotificationStatus.PENDING,
          errorCode: failure.code,
          scheduledFor: new Date(
            this.clock().getTime() + retryDelayMs(notification.attempts),
          ),
        });
        return 'retried';
      }
      await this.finish(id, {
        status: NotificationStatus.FAILED,
        errorCode: failure.code,
      });
      return 'failed';
    }
  }
}
