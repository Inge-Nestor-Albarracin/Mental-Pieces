import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
  ],
  controllers: [
    PatientsController,
  ],
  providers: [
    PatientsService,
  ],
})
export class PatientsModule {}