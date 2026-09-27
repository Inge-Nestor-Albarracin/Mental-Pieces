import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
  ],

  controllers: [
    AppointmentsController,
  ],

  providers: [
    AppointmentsService,
  ],

  exports: [
    AppointmentsService,
  ],
})
export class AppointmentsModule {}
