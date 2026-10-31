import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentLifecycleController } from './appointment-lifecycle.controller';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';
import { StaffDeskController } from './staff-desk.controller';
import { StaffDeskService } from './staff-desk.service';

@Module({
  imports: [DatabaseModule, AuthModule, PushModule],

  controllers: [
    AppointmentsController,
    AppointmentLifecycleController,
    StaffDeskController,
  ],

  providers: [
    AppointmentsService,
    AppointmentLifecycleService,
    StaffDeskService,
  ],

  exports: [AppointmentsService],
})
export class AppointmentsModule {}
