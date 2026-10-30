import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AcceptDataPolicyDto } from '../legal/dto/accept-data-policy.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { PatientsService } from './patients.service';

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get('me')
  getMyProfile(@Req() request: AuthenticatedRequest) {
    return this.patientsService.getMyProfile(request.user.sub);
  }

  @Patch('me')
  updateMyProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.patientsService.updateMyProfile(request.user.sub, dto);
  }

  // Existing accounts accept the current data policy explicitly (registration
  // records it at sign-up). Identity comes from the JWT, the time from the server.
  @Post('me/data-policy-acceptance')
  acceptDataPolicy(
    @Req() request: AuthenticatedRequest,
    @Body() dto: AcceptDataPolicyDto,
  ) {
    return this.patientsService.acceptDataPolicy(
      request.user.sub,
      dto.dataPolicyVersion,
    );
  }

  // Optional 24 h email reminders. Confirmations, changes and cancellations are
  // operational messages and do not depend on this preference.
  @Patch('me/notification-preferences')
  updateNotificationPreferences(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.patientsService.updateNotificationPreferences(
      request.user.sub,
      dto.emailReminders,
    );
  }
}
