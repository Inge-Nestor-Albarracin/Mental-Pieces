import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { isAllowedPushEndpoint } from '../notifications/push/push-endpoint';
import { renderTestPushMessage } from '../notifications/push/push-messages';
import { classifyPushFailure } from '../notifications/push/push-sender';
import { PushDispatcher } from './push-dispatcher';
import type {
  PushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dto/push-subscription.dto';

// Devices per account: a phone, a computer, a tablet... Oldest ones are dropped.
export const MAX_SUBSCRIPTIONS_PER_USER = 5;

const INVALID_SUBSCRIPTION = 'La suscripción no es válida.';

@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: PushDispatcher,
  ) {}

  // The public VAPID key is not a secret: browsers need it to subscribe.
  getConfig() {
    return {
      enabled: this.dispatcher.enabled,
      publicKey: this.dispatcher.enabled
        ? this.dispatcher.config.publicKey
        : null,
    };
  }

  async subscribe(userId: string, dto: PushSubscriptionDto) {
    this.assertEnabled();
    if (!isAllowedPushEndpoint(dto.endpoint))
      throw new BadRequestException(INVALID_SUBSCRIPTION);
    await this.assertActiveUser(userId);

    // Upsert by endpoint: the same browser signing in with another account moves the
    // subscription, so the previous account stops receiving pushes on this device.
    await this.prisma.$transaction(async (tx) => {
      await tx.pushSubscription.upsert({
        where: { endpoint: dto.endpoint },
        create: {
          userId,
          endpoint: dto.endpoint,
          p256dh: dto.p256dh,
          auth: dto.auth,
        },
        update: { userId, p256dh: dto.p256dh, auth: dto.auth },
        select: { id: true },
      });
      const extra = await tx.pushSubscription.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: MAX_SUBSCRIPTIONS_PER_USER,
        select: { id: true },
      });
      if (extra.length) {
        await tx.pushSubscription.deleteMany({
          where: { id: { in: extra.map((row) => row.id) } },
        });
      }
    });
    return { subscribed: true };
  }

  // Logout or "turn off": only the caller's own subscription can be removed.
  async unsubscribe(userId: string, dto: RemovePushSubscriptionDto) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint: dto.endpoint },
    });
    return { subscribed: false };
  }

  // Sends one test notification to the caller's own devices, now (not queued).
  async sendTest(userId: string) {
    this.assertEnabled();
    const sender = this.dispatcher.getSender()!;
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    let delivered = 0;
    for (const subscription of subscriptions) {
      try {
        await sender.send(subscription, renderTestPushMessage());
        delivered += 1;
      } catch (error: unknown) {
        if (classifyPushFailure(error).gone) {
          await this.prisma.pushSubscription.deleteMany({
            where: { id: subscription.id },
          });
        }
      }
    }
    return { devices: subscriptions.length, delivered };
  }

  private assertEnabled() {
    if (!this.dispatcher.enabled)
      throw new ServiceUnavailableException(
        'Las notificaciones push no están disponibles en este momento.',
      );
  }

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });
    if (!user?.isActive)
      throw new ForbiddenException('Tu cuenta no está activa.');
  }
}
