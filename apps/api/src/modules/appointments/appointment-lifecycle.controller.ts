import {
  Body,
  Controller,
  Header,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AppointmentStatus, UserRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';
import { FinishAppointmentDto } from './dto/finish-appointment.dto';

@Controller('appointments/psychologist/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PSYCHOLOGIST)
export class AppointmentLifecycleController {
  constructor(private readonly lifecycle: AppointmentLifecycleService) {}

  @Patch(':id/complete')
  @Header('Cache-Control', 'no-store')
  complete(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: FinishAppointmentDto,
    @Query() query: FinishAppointmentDto,
  ) {
    void body;
    void query;
    return this.lifecycle.finish(
      request.user.sub,
      id,
      AppointmentStatus.COMPLETED,
    );
  }

  @Patch(':id/no-show')
  @Header('Cache-Control', 'no-store')
  noShow(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: FinishAppointmentDto,
    @Query() query: FinishAppointmentDto,
  ) {
    void body;
    void query;
    return this.lifecycle.finish(
      request.user.sub,
      id,
      AppointmentStatus.NO_SHOW,
    );
  }
}
