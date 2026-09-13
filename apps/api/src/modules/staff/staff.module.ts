import { Module } from '@nestjs/common';

import {
  DatabaseModule,
} from '../../database/database.module';

import {
  AuthModule,
} from '../auth/auth.module';

import {
  StaffController,
} from './staff.controller';

import {
  StaffService,
} from './staff.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
  ],

  controllers: [
    StaffController,
  ],

  providers: [
    StaffService,
  ],

  exports: [
    StaffService,
  ],
})
export class StaffModule {}