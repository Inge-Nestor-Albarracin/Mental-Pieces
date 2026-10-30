import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { LegalController } from './legal.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [LegalController],
})
export class LegalModule {}
