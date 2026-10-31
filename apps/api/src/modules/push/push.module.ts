import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { PushDispatcher } from './push-dispatcher';
import { PushService } from './push.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PushController],
  providers: [PushDispatcher, PushService],
  exports: [PushDispatcher],
})
export class PushModule {}
