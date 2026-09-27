import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  AppointmentsService,
} from './appointments.service';

import {
  CancelAppointmentDto,
} from './dto/cancel-appointment.dto';

import {
  CreateAppointmentDto,
} from './dto/create-appointment.dto';

import {
  RescheduleAppointmentDto,
} from './dto/reschedule-appointment.dto';

@Controller('appointments')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
export class AppointmentsController {
  constructor(
    private readonly appointmentsService:
      AppointmentsService,
  ) {}

  @Post('me')
  @Roles(UserRole.PATIENT)
  create(
    @Req()
    request: AuthenticatedRequest,

    @Body()
    dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.create(
      request.user.sub,
      dto,
    );
  }

  @Get('me')
  @Roles(UserRole.PATIENT)
  getMine(
    @Req()
    request: AuthenticatedRequest,
  ) {
    return this.appointmentsService.getMine(
      request.user.sub,
    );
  }

  @Patch('me/:id/cancel')
  @Roles(UserRole.PATIENT)
  cancel(
    @Req()
    request: AuthenticatedRequest,

    @Param('id')
    id: string,

    @Body()
    dto: CancelAppointmentDto,
  ) {
    return this.appointmentsService.cancel(
      request.user.sub,
      id,
      dto,
    );
  }

  @Patch('me/:id/reschedule')
  @Roles(UserRole.PATIENT)
  reschedule(
    @Req()
    request: AuthenticatedRequest,

    @Param('id')
    id: string,

    @Body()
    dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(
      request.user.sub,
      id,
      dto,
    );
  }

  @Get('psychologist/me')
  @Roles(UserRole.PSYCHOLOGIST)
  getPsychologistAgenda(
    @Req()
    request: AuthenticatedRequest,
  ) {
    return this.appointmentsService.getPsychologistAgenda(
      request.user.sub,
    );
  }

  @Get('available-slots')
  @Roles(
    UserRole.PATIENT,
    UserRole.PSYCHOLOGIST,
  )
  getAvailableSlots(
    @Req()
    request: AuthenticatedRequest,

    @Query('psychologistId')
    psychologistId: string,

    @Query('date')
    date: string,
  ) {
    return this.appointmentsService.getAvailableSlots(
      request.user.sub,
      psychologistId,
      date,
    );
  }
}
