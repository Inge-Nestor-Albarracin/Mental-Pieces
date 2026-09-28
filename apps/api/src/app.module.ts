import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { DatabaseModule } from './database/database.module';

import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { PatientsModule } from './modules/patients/patients.module';
import { StaffModule } from './modules/staff/staff.module';
import { UsersModule } from './modules/users/users.module';
import { ClinicalModule } from './modules/clinical/clinical.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    DatabaseModule,
    UsersModule,
    AuthModule,
    PatientsModule,
    StaffModule,
    AvailabilityModule,
    AppointmentsModule,
    ClinicalModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
