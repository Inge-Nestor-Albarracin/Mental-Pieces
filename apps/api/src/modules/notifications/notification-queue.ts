import { Prisma } from '../../../generated/prisma/client';
import {
  NotificationChannel,
  NotificationStatus,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../database/prisma.service';

// Queue operations shared by the email and the push processors. Every operation is
// scoped to ONE channel, so an email run never claims a push message and vice versa.

// Timestamps are stored as UTC in "timestamp without time zone": compare in UTC
// explicitly so the database session time zone can never shift the result.
const utc = (date: Date) =>
  Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export class NotificationQueue {
  constructor(
    private readonly prisma: PrismaService,
    readonly channel: NotificationChannel,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // Atomic claim: FOR UPDATE SKIP LOCKED lets two simultaneous runs take disjoint rows.
  async claim(limit: number, leaseMs: number): Promise<string[]> {
    if (limit <= 0) return [];
    const now = this.clock();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const channel = Prisma.sql`${this.channel}::"NotificationChannel"`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Notification"
      SET status = 'PROCESSING',
          "lockedUntil" = ${utc(leaseUntil)},
          attempts = attempts + 1,
          "lastAttemptAt" = ${utc(now)},
          "updatedAt" = ${utc(now)}
      WHERE id IN (
        SELECT id FROM "Notification"
        WHERE status = 'PENDING' AND channel = ${channel}
          AND "scheduledFor" <= ${utc(now)}
        ORDER BY "scheduledFor" ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows.map((row) => row.id);
  }

  // A claim whose lease expired belongs to an interrupted run (killed cron, crash).
  async recoverExpiredClaims(maxAttempts: number): Promise<number> {
    const now = this.clock();
    const expired = {
      channel: this.channel,
      status: NotificationStatus.PROCESSING,
      lockedUntil: { lt: now },
    };
    const exhausted = await this.prisma.notification.updateMany({
      where: { ...expired, attempts: { gte: maxAttempts } },
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
  async release(ids: string[]): Promise<number> {
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

  async finish(id: string, data: Prisma.NotificationUpdateManyMutationInput) {
    await this.prisma.notification.updateMany({
      where: { id, status: NotificationStatus.PROCESSING },
      data: { ...data, lockedUntil: null },
    });
  }

  // Messages of this channel accepted by the provider since `since`.
  countAccepted(since: Date, recipientUserId?: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        channel: this.channel,
        status: NotificationStatus.ACCEPTED,
        acceptedAt: { gte: since },
        ...(recipientUserId ? { recipientUserId } : {}),
      },
    });
  }
}
