import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { UserRole } from '../../../generated/prisma/client';
import { RATE_LIMITS, throttle } from '../../security/rate-limits';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { StaffPageDto } from './dto/staff-page.dto';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // Internal accounts (PSYCHOLOGIST / STAFF) are created only by an ADMIN.
  // Public sign-up (POST /users) always creates PATIENT accounts.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Throttle(throttle(RATE_LIMITS.staffCreate))
  createInternalUser(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateStaffUserDto,
  ) {
    return this.staffService.createInternalUser(request.user.sub, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Header('Cache-Control', 'no-store')
  listInternalUsers(
    @Req() request: AuthenticatedRequest,
    @Query() query: StaffPageDto,
  ) {
    return this.staffService.listInternalUsers(request.user.sub, query.page);
  }

  @Get('psychologists')
  @UseGuards(JwtAuthGuard)
  findPsychologists() {
    return this.staffService.findActivePsychologists();
  }
}
