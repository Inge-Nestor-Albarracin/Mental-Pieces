import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentLifecycleController } from './appointment-lifecycle.controller';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';

@Module({
  imports: [DatabaseModule, AuthModule],

  controllers: [AppointmentsController, AppointmentLifecycleController],

  providers: [AppointmentsService, AppointmentLifecycleService],

  exports: [AppointmentsService],
})
export class AppointmentsModule {}
