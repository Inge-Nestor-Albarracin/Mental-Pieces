import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ClinicalAuditAction, UserRole } from '../../../generated/prisma/enums';
import { ClinicalAccessService } from './clinical-access.service';
import { ClinicalTransactionService } from './clinical-transaction.service';
import { CreateCareRelationshipDto } from './dto/create-care-relationship.dto';

const RELATIONSHIP_SELECT = {
  id: true,
  patientId: true,
  psychologistId: true,
  isActive: true,
  assignedAt: true,
  endedAt: true,
} as const;

const ADMIN_PAGE_SIZE = 50;

// Administrative view: names only. No notes, contact data or profiles.
const ASSIGNMENT_LIST_SELECT = {
  id: true,
  isActive: true,
  assignedAt: true,
  endedAt: true,
  patient: { select: { id: true, fullName: true } },
  psychologist: {
    select: { id: true, staffProfile: { select: { fullName: true } } },
  },
} as const;

@Injectable()
export class CareRelationshipsService {
  constructor(
    private readonly transactions: ClinicalTransactionService,
    private readonly access: ClinicalAccessService,
  ) {}

  listAssignments(actorUserId: string, page: number) {
    return this.transactions.run(async (tx) => {
      await this.access.assertActiveAdmin(tx, actorUserId);
      const relationships = await tx.careRelationship.findMany({
        orderBy: [{ isActive: 'desc' }, { assignedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE + 1,
        select: ASSIGNMENT_LIST_SELECT,
      });
      return {
        items: relationships.slice(0, ADMIN_PAGE_SIZE).map((item) => ({
          id: item.id,
          isActive: item.isActive,
          assignedAt: item.assignedAt,
          endedAt: item.endedAt,
          patient: {
            id: item.patient.id,
            fullName: item.patient.fullName ?? null,
          },
          psychologist: {
            id: item.psychologist.id,
            fullName: item.psychologist.staffProfile?.fullName ?? null,
          },
        })),
        page,
        pageSize: ADMIN_PAGE_SIZE,
        hasMore: relationships.length > ADMIN_PAGE_SIZE,
      };
    });
  }

  // Patients that can receive an assignment: active PATIENT accounts only.
  listAssignablePatients(actorUserId: string, page: number) {
    return this.transactions.run(async (tx) => {
      await this.access.assertActiveAdmin(tx, actorUserId);
      const patients = await tx.patient.findMany({
        where: { user: { role: UserRole.PATIENT, isActive: true } },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE + 1,
        select: { id: true, fullName: true, mrn: true },
      });
      return {
        items: patients.slice(0, ADMIN_PAGE_SIZE),
        page,
        pageSize: ADMIN_PAGE_SIZE,
        hasMore: patients.length > ADMIN_PAGE_SIZE,
      };
    });
  }

  create(actorUserId: string, dto: CreateCareRelationshipDto) {
    return this.transactions.run(async (tx) => {
      await this.access.assertActiveAdmin(tx, actorUserId);
      const patient = await tx.patient.findFirst({
        where: {
          id: dto.patientId,
          user: { role: UserRole.PATIENT, isActive: true },
        },
        select: { id: true },
      });
      const psychologist = await tx.user.findFirst({
        where: {
          id: dto.psychologistId,
          role: UserRole.PSYCHOLOGIST,
          isActive: true,
          staffProfile: { isNot: null },
        },
        select: { id: true },
      });
      if (!patient || !psychologist)
        throw new NotFoundException(
          'No fue posible registrar la relación clínica.',
        );

      const relationship = await tx.careRelationship.create({
        data: { patientId: patient.id, psychologistId: psychologist.id },
        select: RELATIONSHIP_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: ClinicalAuditAction.CARE_RELATIONSHIP_CREATED,
          resourceType: 'CareRelationship',
          resourceId: relationship.id,
        },
        select: { id: true },
      });
      return relationship;
    });
  }

  end(actorUserId: string, relationshipId: string) {
    return this.transactions.run(async (tx) => {
      await this.access.assertActiveAdmin(tx, actorUserId);
      const relationship = await tx.careRelationship.findUnique({
        where: { id: relationshipId },
        select: RELATIONSHIP_SELECT,
      });
      if (!relationship)
        throw new NotFoundException('Relación clínica no encontrada.');
      if (!relationship.isActive)
        throw new ConflictException('La relación clínica ya finalizó.');
      const ended = await tx.careRelationship.update({
        where: { id: relationship.id },
        data: { isActive: false, endedAt: new Date() },
        select: RELATIONSHIP_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: ClinicalAuditAction.CARE_RELATIONSHIP_ENDED,
          resourceType: 'CareRelationship',
          resourceId: relationship.id,
        },
        select: { id: true },
      });
      return ended;
    });
  }
}
