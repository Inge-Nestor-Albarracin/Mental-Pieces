import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { RATE_LIMITS, throttle } from '../../security/rate-limits';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import {
  PushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dto/push-subscription.dto';
import { PushService } from './push.service';

// Every role (patient, psychologist, admin, staff) can receive pushes on its own devices.
@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  getConfig() {
    return this.pushService.getConfig();
  }

  @Post('subscriptions')
  @HttpCode(200)
  @Throttle(throttle(RATE_LIMITS.pushSubscription))
  subscribe(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PushSubscriptionDto,
  ) {
    return this.pushService.subscribe(request.user.sub, dto);
  }

  @Delete('subscriptions')
  @Throttle(throttle(RATE_LIMITS.pushSubscription))
  unsubscribe(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RemovePushSubscriptionDto,
  ) {
    return this.pushService.unsubscribe(request.user.sub, dto);
  }

  @Post('test')
  @HttpCode(200)
  @Throttle(throttle(RATE_LIMITS.pushTest))
  sendTest(@Req() request: AuthenticatedRequest) {
    return this.pushService.sendTest(request.user.sub);
  }
}
