import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  UserRole,
} from '../../../generated/prisma/client';

import {
  JwtAuthGuard,
} from '../auth/auth.guard';

import {
  Roles,
} from '../auth/roles.decorator';

import {
  RolesGuard,
} from '../auth/roles.guard';

import {
  CreateStaffUserDto,
} from './dto/create-staff-user.dto';

import {
  StaffService,
} from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(
    private readonly staffService:
      StaffService,
  ) {}

  @Post()
  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(UserRole.ADMIN)
  createInternalUser(
    @Body() dto: CreateStaffUserDto,
  ) {
    return this.staffService
      .createInternalUser(dto);
  }

  @Get('psychologists')
  @UseGuards(JwtAuthGuard)
  findPsychologists() {
    return this.staffService
      .findActivePsychologists();
  }
}