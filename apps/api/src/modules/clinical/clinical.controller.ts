import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ClinicalService } from './clinical.service';
import { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';
import { ClinicalPageDto } from './dto/clinical-page.dto';

@Controller('clinical')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PSYCHOLOGIST)
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @Get('patients')
  @Header('Cache-Control', 'no-store')
  listPatients(
    @Req() request: AuthenticatedRequest,
    @Query() query: ClinicalPageDto,
  ) {
    return this.clinical.listPatients(request.user.sub, query.page);
  }

  @Get('patients/:patientId/notes')
  @Header('Cache-Control', 'no-store')
  listNotes(
    @Req() request: AuthenticatedRequest,
    @Param('patientId') patientId: string,
    @Query() query: ClinicalPageDto,
  ) {
    return this.clinical.listNotes(request.user.sub, patientId, query.page);
  }

  @Post('patients/:patientId/notes')
  @Header('Cache-Control', 'no-store')
  createNote(
    @Req() request: AuthenticatedRequest,
    @Param('patientId') patientId: string,
    @Body() dto: CreateClinicalNoteDto,
  ) {
    return this.clinical.createNote(request.user.sub, patientId, dto);
  }
}
