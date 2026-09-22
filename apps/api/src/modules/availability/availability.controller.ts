import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  UserRole,
} from '../../../generated/prisma/client';

import {
  JwtAuthGuard,
} from '../auth/auth.guard';

import type {
  AuthenticatedRequest,
} from '../auth/auth.guard';

import {
  Roles,
} from '../auth/roles.decorator';

import {
  RolesGuard,
} from '../auth/roles.guard';

import {
  AvailabilityService,
} from './availability.service';

import {
  CreateAvailabilityDto,
} from './dto/create-availability.dto';

@Controller('availability')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
export class AvailabilityController {
  constructor(
    private readonly availabilityService:
      AvailabilityService,
  ) {}

  @Post('me')
  @Roles(UserRole.PSYCHOLOGIST)
  createMyAvailability(
    @Req()
    request:
      AuthenticatedRequest,

    @Body()
    dto:
      CreateAvailabilityDto,
  ) {
    return this.availabilityService
      .create(
        request.user.sub,
        dto,
      );
  }

  @Get('me')
  @Roles(UserRole.PSYCHOLOGIST)
  getMyAvailability(
    @Req()
    request:
      AuthenticatedRequest,
  ) {
    return this.availabilityService
      .getMine(
        request.user.sub,
      );
  }

  @Delete('me/:id')
  @Roles(UserRole.PSYCHOLOGIST)
  removeMyAvailability(
    @Req()
    request:
      AuthenticatedRequest,

    @Param('id')
    id: string,
  ) {
    return this.availabilityService
      .remove(
        request.user.sub,
        id,
      );
  }

  @Get(
    'psychologists/:psychologistId',
  )
  @Roles(
    UserRole.PATIENT,
    UserRole.PSYCHOLOGIST,
    UserRole.STAFF,
    UserRole.ADMIN,
  )
  getPsychologistAvailability(
    @Param('psychologistId')
    psychologistId: string,
  ) {
    return this.availabilityService
      .getForPsychologist(
        psychologistId,
      );
  }
}