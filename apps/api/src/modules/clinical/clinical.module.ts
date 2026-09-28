import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CareRelationshipsController } from './care-relationships.controller';
import { CareRelationshipsService } from './care-relationships.service';
import { ClinicalAccessService } from './clinical-access.service';
import { ClinicalController } from './clinical.controller';
import { ClinicalService } from './clinical.service';
import { ClinicalTransactionService } from './clinical-transaction.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ClinicalController, CareRelationshipsController],
  providers: [
    ClinicalService,
    CareRelationshipsService,
    ClinicalAccessService,
    ClinicalTransactionService,
  ],
  exports: [ClinicalAccessService],
})
export class ClinicalModule {}
