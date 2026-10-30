import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

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
import { LegalModule } from './modules/legal/legal.module';
import { RATE_LIMITS } from './security/rate-limits';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Per-IP request limits on every route; stricter limits are set per route.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ...RATE_LIMITS.default }],
      errorMessage:
        'Demasiadas solicitudes. Espera un momento e intenta de nuevo.',
    }),

    DatabaseModule,
    UsersModule,
    AuthModule,
    PatientsModule,
    StaffModule,
    AvailabilityModule,
    AppointmentsModule,
    ClinicalModule,
    LegalModule,
  ],

  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
