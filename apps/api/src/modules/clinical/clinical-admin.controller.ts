import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CareRelationshipsService } from './care-relationships.service';
import { ClinicalPageDto } from './dto/clinical-page.dto';

// Administrative lookups for assignment management. Never clinical content.
@Controller('clinical/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ClinicalAdminController {
  constructor(private readonly relationships: CareRelationshipsService) {}

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
