import {
  NotificationChannel,
  NotificationStatus,
} from '../../../../generated/prisma/enums';
import type { PrismaService } from '../../../database/prisma.service';
import { NotificationQueue } from '../notification-queue';
import { decidePushDelivery, retryDelayMs } from '../notification-rules';
import type { PushConfig } from './push-config';
import { renderPushMessage } from './push-messages';
import { classifyPushFailure, type PushSender } from './push-sender';

// One bounded run over PUSH messages: recover interrupted claims, claim a batch, send
// each one to every subscription of its recipient, record the result. Started by the
// cron CLI and, right after a booking change commits, by the API (PushDispatcher).

export interface PushRunSummary {
  enabled: boolean;
  recovered: number;
  claimed: number;
  accepted: number;
  retried: number;
  failed: number;
  skipped: number;
  released: number;
  stoppedBy: 'done' | 'disabled' | 'time_budget';
}

type Outcome = 'accepted' | 'retried' | 'failed' | 'skipped';

export class PushProcessor {
  private readonly queue: NotificationQueue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
    private readonly config: PushConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.queue = new NotificationQueue(prisma, NotificationChannel.PUSH, clock);
  }

  async runOnce(): Promise<PushRunSummary> {
    const summary: PushRunSummary = {
      enabled: this.config.enabled,
      recovered: 0,
      claimed: 0,
      accepted: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
      released: 0,
      stoppedBy: 'done',
    };
    if (!this.config.enabled) return { ...summary, stoppedBy: 'disabled' };

    const started = Date.now();
    summary.recovered = await this.queue.recoverExpiredClaims(
      this.config.maxAttempts,
    );
    const ids = await this.queue.claim(
      this.config.batchSize,
      this.config.leaseMs,
    );
    summary.claimed = ids.length;

    for (let index = 0; index < ids.length; index++) {
      if (Date.now() - started > this.config.maxRuntimeMs) {
        summary.released = await this.queue.release(ids.slice(index));
        summary.stoppedBy = 'time_budget';
        break;
      }
      summary[await this.processOne(ids[index])] += 1;
    }
    return summary;
  }

  private async processOne(id: string): Promise<Outcome> {
    const now = this.clock();
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      select: {
        type: true,
        recipientUserId: true,
        appointmentId: true,
        appointmentDate: true,
        startMinute: true,
        attempts: true,
        createdAt: true,
        recipient: { select: { role: true, isActive: true } },
        appointment: {
          select: {
            status: true,
            appointmentDate: true,
            startMinute: true,
            endMinute: true,
            psychologistId: true,
            patient: { select: { userId: true } },
          },
        },
      },
    });
    if (!notification) return 'skipped';

    const decision = decidePushDelivery(
      notification,
      now,
      this.config.maxDelayMs,
    );
    if (!decision.send) {
      await this.queue.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: decision.reason,
      });
      return 'skipped';
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: notification.recipientUserId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subscriptions.length === 0) {
      await this.queue.finish(id, {
        status: NotificationStatus.CANCELLED,
        errorCode: 'NO_SUBSCRIPTION',
      });
      return 'skipped';
    }

    const message = renderPushMessage({
      type: notification.type,
      audience: decision.audience,
      appointmentId: notification.appointmentId,
      appointmentDate: notification.appointmentDate,
      startMinute: notification.startMinute,
    });

    let delivered = 0;
    let lastFailure: ReturnType<typeof classifyPushFailure> | null = null;
    let anyTransient = false;
    for (const subscription of subscriptions) {
      try {
        await this.sender.send(subscription, message);
        delivered += 1;
        await this.prisma.pushSubscription.updateMany({
          where: { id: subscription.id },
          data: { lastSuccessAt: this.clock() },
        });
      } catch (error: unknown) {
        const failure = classifyPushFailure(error);
        lastFailure = failure;
        if (failure.gone) {
          // The browser unsubscribed or the permission was revoked: forget it.
          await this.prisma.pushSubscription.deleteMany({
            where: { id: subscription.id },
          });
        } else if (failure.transient) {
          anyTransient = true;
        }
      }
    }

    if (delivered > 0) {
      await this.queue.finish(id, {
        status: NotificationStatus.ACCEPTED,
        acceptedAt: this.clock(),
        errorCode: null,
      });
      return 'accepted';
    }
    const code = lastFailure?.code ?? 'PUSH_ERROR';
    if (anyTransient && notification.attempts < this.config.maxAttempts) {
      await this.queue.finish(id, {
        status: NotificationStatus.PENDING,
        errorCode: code,
        scheduledFor: new Date(
          this.clock().getTime() + retryDelayMs(notification.attempts),
        ),
      });
      return 'retried';
    }
    await this.queue.finish(id, {
      status: NotificationStatus.FAILED,
      errorCode: code,
    });
    return 'failed';
  }
}
