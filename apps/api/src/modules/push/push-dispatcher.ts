import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { NotificationsConfigError } from '../notifications/notifications-config';
import {
  loadPushConfig,
  PUSH_DISABLED,
  type PushConfig,
} from '../notifications/push/push-config';
import { PushProcessor } from '../notifications/push/push-processor';
import {
  WebPushSender,
  type PushSender,
} from '../notifications/push/push-sender';

// Sends queued push messages right after a booking change commits, so a booking
// alert arrives in seconds instead of waiting for the next cron run. Best effort:
// it never delays or fails the HTTP request; whatever it misses (crash, push service
// down, retries, 24 h reminders) is sent by the cron run of the notifications CLI.
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger(PushDispatcher.name);
  readonly config: PushConfig;
  private readonly sender: PushSender | null;
  private running = false;
  private pending = false;

  constructor(private readonly prisma: PrismaService) {
    let config = PUSH_DISABLED;
    try {
      config = loadPushConfig();
    } catch (error: unknown) {
      // Variable names only, never values.
      if (error instanceof NotificationsConfigError)
        this.logger.error(`${error.message}. Push desactivado.`);
      else throw error;
    }
    this.config = config;
    this.sender = config.enabled ? new WebPushSender(config) : null;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  getSender(): PushSender | null {
    return this.sender;
  }

  // Call after the transaction that queued the messages has committed.
  kick(): void {
    if (!this.sender) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    setImmediate(() => void this.drain());
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.pending = false;
        await new PushProcessor(
          this.prisma,
          this.sender!,
          this.config,
        ).runOnce();
      } while (this.pending);
    } catch (error: unknown) {
      const name = (error as { name?: string })?.name ?? 'Error';
      const code = (error as { code?: string })?.code ?? '';
      this.logger.warn(`push run failed: ${name} ${code}`.trim());
    } finally {
      this.running = false;
    }
  }
}
