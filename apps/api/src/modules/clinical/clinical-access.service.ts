import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UserRole } from '../../../generated/prisma/enums';

@Injectable()
export class ClinicalAccessService {
  activeRelationshipWhere(
    psychologistUserId: string,
  ): Prisma.CareRelationshipWhereInput {
    return {
      psychologistId: psychologistUserId,
      isActive: true,
      endedAt: null,
      psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
      patient: { user: { role: UserRole.PATIENT, isActive: true } },
    };
  }

  async assertPsychologistCanAccessPatient(
    tx: Prisma.TransactionClient,
    psychologistUserId: string,
    patientId: string,
  ): Promise<void> {
    const relationship = await tx.careRelationship.findFirst({
      where: { ...this.activeRelationshipWhere(psychologistUserId), patientId },
      select: { id: true },
    });
    if (!relationship)
      throw new NotFoundException('Recurso clínico no encontrado.');
  }

  async assertActiveAdmin(
    tx: Prisma.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    const actor = await tx.user.findFirst({
      where: { id: actorUserId, role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    if (!actor)
      throw new ForbiddenException('No tienes permisos para esta operación.');
  }
}
