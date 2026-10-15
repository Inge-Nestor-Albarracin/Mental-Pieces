import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, throttle } from '../../security/rate-limits';
import { CareAlertsService } from './care-alerts.service';
import { CareRelationshipsService } from './care-relationships.service';
import { ClinicalPageDto } from './dto/clinical-page.dto';

// Administrative lookups for assignment management. Never clinical content.
@Controller('clinical/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ClinicalAdminController {
  constructor(
    private readonly relationships: CareRelationshipsService,
    private readonly alerts: CareAlertsService,
  ) {}

  @Get('alerts')
  @Throttle(throttle(RATE_LIMITS.heavyRead))
  @Header('Cache-Control', 'no-store')
  listAlerts(
    @Req() request: AuthenticatedRequest,
    @Query() query: ClinicalPageDto,
  ) {
    return this.alerts.listForAdmin(request.user.sub, query.page);
  }

  @Get('patients')
  @Header('Cache-Control', 'no-store')
  listPatients(
    @Req() request: AuthenticatedRequest,
    @Query() query: ClinicalPageDto,
  ) {
    return this.relationships.listAssignablePatients(
      request.user.sub,
      query.page,
    );
  }
}
