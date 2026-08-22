import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard'; 
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { PatientsService } from './patients.service';

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
export class PatientsController {
  constructor(
    private readonly patientsService: PatientsService,
  ) {}

  @Get('me')
  getMyProfile(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patientsService.getMyProfile(
      request.user.sub,
    );
  }

  @Patch('me')
  updateMyProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.patientsService.updateMyProfile(
      request.user.sub,
      dto,
    );
  }
}