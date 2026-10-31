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
import { AppointmentsService } from './appointments.service';
import { StaffCreateAppointmentDto } from './dto/staff-create-appointment.dto';
import {
  StaffAgendaQueryDto,
  StaffPatientSearchDto,
} from './dto/staff-desk-query.dto';
import { StaffDeskService } from './staff-desk.service';

// Reception portal. STAFF only; services re-check the role and active state in the DB.
@Controller('staff-desk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STAFF)
export class StaffDeskController {
  constructor(
    private readonly desk: StaffDeskService,
    private readonly appointments: AppointmentsService,
  ) {}

  @Get('patients')
  @Header('Cache-Control', 'no-store')
  @Throttle(throttle(RATE_LIMITS.patientSearch))
  searchPatients(
    @Req() request: AuthenticatedRequest,
    @Query() query: StaffPatientSearchDto,
  ) {
    return this.desk.searchPatients(request.user.sub, query.search);
  }

  @Get('agenda')
  @Header('Cache-Control', 'no-store')
  @Throttle(throttle(RATE_LIMITS.heavyRead))
  agenda(
    @Req() request: AuthenticatedRequest,
    @Query() query: StaffAgendaQueryDto,
  ) {
    return this.desk.upcomingByPsychologist(
      request.user.sub,
      query.days,
      query.psychologistId,
    );
  }

  @Post('appointments')
  @Throttle(throttle(RATE_LIMITS.appointmentWrite))
  book(
    @Req() request: AuthenticatedRequest,
    @Body() dto: StaffCreateAppointmentDto,
  ) {
    return this.appointments.createForPatient(request.user.sub, dto);
  }
}
