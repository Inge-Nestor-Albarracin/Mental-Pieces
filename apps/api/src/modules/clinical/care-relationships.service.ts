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

@Injectable()
export class CareRelationshipsService {
  constructor(
    private readonly transactions: ClinicalTransactionService,
    private readonly access: ClinicalAccessService,
  ) {}

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
