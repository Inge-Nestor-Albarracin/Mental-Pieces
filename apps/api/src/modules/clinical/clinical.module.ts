import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CareAlertsService } from './care-alerts.service';
import { CareRelationshipsController } from './care-relationships.controller';
import { CareRelationshipsService } from './care-relationships.service';
import { ClinicalAccessService } from './clinical-access.service';
import { ClinicalAdminController } from './clinical-admin.controller';
import { ClinicalController } from './clinical.controller';
import { ClinicalService } from './clinical.service';
import { ClinicalTransactionService } from './clinical-transaction.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    ClinicalController,
    CareRelationshipsController,
    ClinicalAdminController,
  ],
  providers: [
    ClinicalService,
    CareRelationshipsService,
    ClinicalAccessService,
    ClinicalTransactionService,
    CareAlertsService,
  ],
  exports: [ClinicalAccessService],
})
export class ClinicalModule {}
