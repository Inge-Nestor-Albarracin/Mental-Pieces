import {
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { RATE_LIMITS, throttle } from '../../security/rate-limits';
import { NotificationsRunnerService } from './notifications-runner.service';

// Called by the Hostinger cron every 5 minutes:
//   curl -fsS -X POST -H "X-Cron-Secret: <secret>" https://api.mentalpieces.site/internal/notifications/run
// No JWT: the shared secret is the credential. Without NOTIFICATIONS_CRON_SECRET the
// route answers 404, as if it did not exist.
@Controller('internal/notifications')
export class NotificationsRunnerController {
  constructor(private readonly runner: NotificationsRunnerService) {}

  @Post('run')
  @HttpCode(202)
  @Throttle(throttle(RATE_LIMITS.cronTrigger))
  run(@Headers('x-cron-secret') secret?: string) {
    const result = this.runner.trigger(secret);
    if (result.status === 'disabled') throw new NotFoundException();
    if (result.status === 'unauthorized') throw new UnauthorizedException();
    return { status: result.status };
  }
}
