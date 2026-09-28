import {
  Body,
  Controller,
  Header,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CareRelationshipsService } from './care-relationships.service';
import { CreateCareRelationshipDto } from './dto/create-care-relationship.dto';

// A concrete DTO type makes the global whitelist reject every body field on end.
export class EndCareRelationshipDto {}

@Controller('clinical/assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CareRelationshipsController {
  constructor(private readonly relationships: CareRelationshipsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCareRelationshipDto,
  ) {
    return this.relationships.create(request.user.sub, dto);
  }

  @Patch(':id/end')
  @Header('Cache-Control', 'no-store')
  end(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: EndCareRelationshipDto,
  ) {
    void dto;
    return this.relationships.end(request.user.sub, id);
  }
}
