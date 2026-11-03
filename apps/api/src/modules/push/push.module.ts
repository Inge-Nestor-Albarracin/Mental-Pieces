import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsRunnerController } from './notifications-runner.controller';
import { NotificationsRunnerService } from './notifications-runner.service';
import { PushController } from './push.controller';
import { PushDispatcher } from './push-dispatcher';
import { PushService } from './push.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PushController, NotificationsRunnerController],
  providers: [PushDispatcher, PushService, NotificationsRunnerService],
  exports: [PushDispatcher],
})
export class PushModule {}
