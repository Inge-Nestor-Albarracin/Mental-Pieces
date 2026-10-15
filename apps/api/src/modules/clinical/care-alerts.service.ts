import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { AppointmentStatus, UserRole } from '../../../generated/prisma/enums';
import {
  CARE_ALERT_RULES,
  evaluateCareAlert,
  type CareAlertAppointment,
  type CareAlertEvaluation,
} from './care-alerts';
import { ClinicalAccessService } from './clinical-access.service';
import { ClinicalTransactionService } from './clinical-transaction.service';

const PAGE_SIZE = 50;
// Alerts are computed in memory over active relationships; beyond this, report truncation.
const MAX_RELATIONSHIPS = 1000;

const ALERT_APPOINTMENT_STATUSES = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.SCHEDULED,
];

interface ActiveRelationship {
  id: string;
  assignedAt: Date;
  patient: { id: string; fullName: string | null };
  psychologist: { id: string; staffProfile: { fullName: string } | null };
}

type Alert = CareAlertEvaluation & {
  relationshipId: string;
  patient: { id: string; fullName: string | null };
  psychologist?: { id: string; fullName: string | null };
};

// Metadata only: appointment dates and statuses. Never notes or contact data.
@Injectable()
export class CareAlertsService {
  constructor(
    private readonly transactions: ClinicalTransactionService,
    private readonly access: ClinicalAccessService,
  ) {}

  listForPsychologist(psychologistUserId: string, page: number) {
    return this.transactions.run(async (tx) => {
      const relationships = await this.activeRelationships(
        tx,
        this.access.activeRelationshipWhere(psychologistUserId),
      );
      return this.build(tx, relationships, page, false);
    });
  }

  listForAdmin(actorUserId: string, page: number) {
    return this.transactions.run(async (tx) => {
      await this.access.assertActiveAdmin(tx, actorUserId);
      const relationships = await this.activeRelationships(tx, {
        isActive: true,
        endedAt: null,
        psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
        patient: { user: { role: UserRole.PATIENT, isActive: true } },
      });
      return this.build(tx, relationships, page, true);
    });
  }

  private activeRelationships(
    tx: Prisma.TransactionClient,
    where: Prisma.CareRelationshipWhereInput,
  ): Promise<ActiveRelationship[]> {
    return tx.careRelationship.findMany({
      where,
      orderBy: { id: 'asc' },
      take: MAX_RELATIONSHIPS + 1,
      select: {
        id: true,
        assignedAt: true,
        patient: { select: { id: true, fullName: true } },
        psychologist: {
          select: { id: true, staffProfile: { select: { fullName: true } } },
        },
      },
    });
  }

  private async build(
    tx: Prisma.TransactionClient,
    found: ActiveRelationship[],
    page: number,
    includePsychologist: boolean,
  ) {
    const truncated = found.length > MAX_RELATIONSHIPS;
    const relationships = found.slice(0, MAX_RELATIONSHIPS);
    const byPair = new Map<string, CareAlertAppointment[]>();
    if (relationships.length > 0) {
      const appointments = await tx.appointment.findMany({
        where: {
          status: { in: ALERT_APPOINTMENT_STATUSES },
          OR: relationships.map((item) => ({
            patientId: item.patient.id,
            psychologistId: item.psychologist.id,
          })),
        },
        select: {
          patientId: true,
          psychologistId: true,
          appointmentDate: true,
          startMinute: true,
          endMinute: true,
          status: true,
        },
      });
      for (const { patientId, psychologistId, ...rest } of appointments) {
        const key = `${patientId}:${psychologistId}`;
        byPair.set(key, [...(byPair.get(key) ?? []), rest]);
      }
    }

    const now = new Date();
    const alerts: Alert[] = [];
    for (const item of relationships) {
      const evaluation = evaluateCareAlert(
        item.assignedAt,
        byPair.get(`${item.patient.id}:${item.psychologist.id}`) ?? [],
        now,
      );
      if (!evaluation) continue;
      alerts.push({
        relationshipId: item.id,
        patient: { id: item.patient.id, fullName: item.patient.fullName },
        ...(includePsychologist
          ? {
              psychologist: {
                id: item.psychologist.id,
                fullName: item.psychologist.staffProfile?.fullName ?? null,
              },
            }
          : {}),
        ...evaluation,
      });
    }
    alerts.sort(
      (a, b) =>
        Number(b.level === 'HIGH') - Number(a.level === 'HIGH') ||
        (b.daysSinceLastSession ?? b.daysSinceAssigned) -
          (a.daysSinceLastSession ?? a.daysSinceAssigned) ||
        a.relationshipId.localeCompare(b.relationshipId),
    );
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: alerts.slice(start, start + PAGE_SIZE),
      page,
      pageSize: PAGE_SIZE,
      hasMore: alerts.length > start + PAGE_SIZE,
      total: alerts.length,
      truncated,
      rules: CARE_ALERT_RULES,
      generatedAt: now,
    };
  }
}
