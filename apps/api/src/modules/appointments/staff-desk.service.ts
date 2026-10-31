import { ForbiddenException, Injectable } from '@nestjs/common';

import { AppointmentStatus, UserRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { hasAcceptedDataPolicy } from '../legal/data-policy';
import { isMinor, isProfileComplete } from '../patients/patient-requirements';
import {
  businessNow,
  formatAppointmentTime,
  hasAppointmentStarted,
} from './appointment-time';

// Reception desk (STAFF): find patients to book for and see each psychologist's
// upcoming appointments. Administrative data only: names, internal record number,
// contact data and times. Never clinical notes, reasons or alerts.

const SEARCH_LIMIT = 20;

export type BookingBlocker = 'PROFILE_INCOMPLETE' | 'DATA_POLICY' | 'MINOR';

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class StaffDeskService {
  constructor(private readonly prisma: PrismaService) {}

  async searchPatients(staffUserId: string, search: string) {
    await this.assertActiveStaff(staffUserId);
    const term = search.trim();
    const patients = await this.prisma.patient.findMany({
      where: {
        user: { isActive: true, role: UserRole.PATIENT },
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          { mrn: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term } },
          { user: { email: { contains: term, mode: 'insensitive' } } },
        ],
      },
      orderBy: [{ fullName: 'asc' }, { mrn: 'asc' }],
      take: SEARCH_LIMIT + 1,
      select: {
        id: true,
        userId: true,
        mrn: true,
        fullName: true,
        birthDate: true,
        gender: true,
        genderOther: true,
        phone: true,
        user: { select: { email: true } },
      },
    });

    const items = await Promise.all(
      patients.slice(0, SEARCH_LIMIT).map(async (patient) => {
        const blockers: BookingBlocker[] = [];
        if (!isProfileComplete(patient)) blockers.push('PROFILE_INCOMPLETE');
        if (!(await hasAcceptedDataPolicy(this.prisma, patient.userId)))
          blockers.push('DATA_POLICY');
        if (patient.birthDate && isMinor(patient.birthDate))
          blockers.push('MINOR');
        return {
          id: patient.id,
          mrn: patient.mrn,
          fullName: patient.fullName,
          email: patient.user.email,
          phone: patient.phone,
          canBook: blockers.length === 0,
          blockers,
        };
      }),
    );
    return { items, hasMore: patients.length > SEARCH_LIMIT };
  }

  // Upcoming (not yet started) scheduled appointments, grouped by active psychologist.
  async upcomingByPsychologist(
    staffUserId: string,
    days: number,
    psychologistId?: string,
  ) {
    await this.assertActiveStaff(staffUserId);
    const today = businessNow().date;
    const until = addDays(today, days - 1);

    const psychologists = await this.prisma.user.findMany({
      where: {
        role: UserRole.PSYCHOLOGIST,
        isActive: true,
        ...(psychologistId ? { id: psychologistId } : {}),
      },
      select: {
        id: true,
        staffProfile: { select: { fullName: true, position: true } },
        psychologistAppointments: {
          where: {
            status: AppointmentStatus.SCHEDULED,
            appointmentDate: { gte: today, lte: until },
          },
          orderBy: [{ appointmentDate: 'asc' }, { startMinute: 'asc' }],
          select: {
            id: true,
            appointmentDate: true,
            startMinute: true,
            endMinute: true,
            bookedByUserId: true,
            patient: { select: { id: true, fullName: true, mrn: true } },
          },
        },
      },
    });

    const groups = psychologists.map((psychologist) => ({
      psychologist: {
        id: psychologist.id,
        fullName: psychologist.staffProfile?.fullName ?? null,
        position: psychologist.staffProfile?.position ?? null,
      },
      appointments: psychologist.psychologistAppointments
        .filter(
          (item) =>
            !hasAppointmentStarted(item.appointmentDate, item.startMinute),
        )
        .map((item) => ({
          id: item.id,
          appointmentDate: item.appointmentDate,
          startTime: formatAppointmentTime(item.startMinute),
          endTime: formatAppointmentTime(item.endMinute),
          bookedByStaff: item.bookedByUserId !== null,
          patient: {
            id: item.patient.id,
            fullName: item.patient.fullName,
            mrn: item.patient.mrn,
          },
        })),
    }));
    groups.sort((a, b) =>
      (a.psychologist.fullName ?? '').localeCompare(
        b.psychologist.fullName ?? '',
        'es',
      ),
    );
    return { from: today, until, psychologists: groups };
  }

  // The token says STAFF; the database must agree and the account must be active.
  private async assertActiveStaff(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true },
    });
    if (!user || user.role !== UserRole.STAFF || !user.isActive) {
      throw new ForbiddenException(
        'Solo el personal activo puede usar este portal.',
      );
    }
  }
}
