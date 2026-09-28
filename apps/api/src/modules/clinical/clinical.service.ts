import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  ClinicalAuditAction,
} from '../../../generated/prisma/enums';
import { ClinicalAccessService } from './clinical-access.service';
import { ClinicalTransactionService } from './clinical-transaction.service';
import { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';

const PAGE_SIZE = 20;
const NOTE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  appointmentId: true,
} as const;

@Injectable()
export class ClinicalService {
  constructor(
    private readonly transactions: ClinicalTransactionService,
    private readonly access: ClinicalAccessService,
  ) {}

  listPatients(psychologistUserId: string, page: number) {
    return this.transactions.run(async (tx) => {
      const relationships = await tx.careRelationship.findMany({
        where: this.access.activeRelationshipWhere(psychologistUserId),
        orderBy: { id: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
        select: { patient: { select: { id: true, fullName: true } } },
      });
      return {
        items: relationships.slice(0, PAGE_SIZE).map((item) => item.patient),
        page,
        pageSize: PAGE_SIZE,
        hasMore: relationships.length > PAGE_SIZE,
      };
    });
  }

  listNotes(psychologistUserId: string, patientId: string, page: number) {
    return this.transactions.run(async (tx) => {
      await this.access.assertPsychologistCanAccessPatient(
        tx,
        psychologistUserId,
        patientId,
      );
      const notes = await tx.clinicalSessionNote.findMany({
        where: {
          patientId,
          psychologistId: psychologistUserId,
          careRelationship:
            this.access.activeRelationshipWhere(psychologistUserId),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
        select: NOTE_SELECT,
      });
      return {
        items: notes.slice(0, PAGE_SIZE),
        page,
        pageSize: PAGE_SIZE,
        hasMore: notes.length > PAGE_SIZE,
      };
    });
  }

  createNote(
    psychologistUserId: string,
    patientId: string,
    dto: CreateClinicalNoteDto,
  ) {
    return this.transactions.run(async (tx) => {
      await this.access.assertPsychologistCanAccessPatient(
        tx,
        psychologistUserId,
        patientId,
      );
      if (dto.appointmentId !== undefined) {
        const appointment = await tx.appointment.findFirst({
          where: {
            id: dto.appointmentId,
            patientId,
            psychologistId: psychologistUserId,
          },
          select: { id: true, status: true },
        });
        if (!appointment) throw new NotFoundException('Cita no encontrada.');
        if (appointment.status !== AppointmentStatus.COMPLETED) {
          throw new BadRequestException(
            'Solo se puede vincular una nota a una cita completada.',
          );
        }
      }
      const note = await tx.clinicalSessionNote.create({
        data: {
          patientId,
          psychologistId: psychologistUserId,
          content: dto.content,
          ...(dto.appointmentId !== undefined
            ? { appointmentId: dto.appointmentId }
            : {}),
        },
        select: NOTE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: psychologistUserId,
          action: ClinicalAuditAction.CLINICAL_NOTE_CREATED,
          resourceType: 'ClinicalSessionNote',
          resourceId: note.id,
        },
        select: { id: true },
      });
      return note;
    }, 'Ya existe una nota clínica principal para esta cita.');
  }
}
