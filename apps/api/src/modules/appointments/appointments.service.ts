import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AppointmentStatus,
  UserRole,
  WeekDay,
} from '../../../generated/prisma/client';

import {
  PrismaService,
} from '../../database/prisma.service';

import {
  CancelAppointmentDto,
} from './dto/cancel-appointment.dto';

import {
  CreateAppointmentDto,
} from './dto/create-appointment.dto';

import {
  RescheduleAppointmentDto,
} from './dto/reschedule-appointment.dto';

const APPOINTMENT_DURATION_MINUTES = 60;
const BUSINESS_TIMEZONE = 'America/Bogota';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    patientUserId: string,
    dto: CreateAppointmentDto,
  ) {
    const patient = await this.prisma.patient.findUnique({
      where: {
        userId: patientUserId,
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      throw new NotFoundException(
        'No se encontró el perfil del paciente.',
      );
    }

    const psychologistId = dto.psychologistId.trim();
    const appointmentDate = this.normalizeCalendarDate(
      dto.appointmentDate,
    );
    const startMinute = this.timeToMinutes(dto.startTime);
    const endMinute = startMinute + APPOINTMENT_DURATION_MINUTES;

    const psychologist = await this.prisma.user.findUnique({
      where: {
        id: psychologistId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
        staffProfile: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (
      !psychologist ||
      psychologist.role !== UserRole.PSYCHOLOGIST ||
      !psychologist.isActive
    ) {
      throw new NotFoundException(
        'El psicólogo no existe o no está activo.',
      );
    }

    this.assertFutureDateAndTime(appointmentDate, startMinute);

    const hasAvailability = await this.hasAvailability(
      psychologistId,
      appointmentDate,
      startMinute,
      endMinute,
    );

    if (!hasAvailability) {
      throw new BadRequestException(
        'La cita debe estar dentro de un bloque activo de disponibilidad del psicólogo.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const psychologistConflict = await tx.appointment.findFirst({
        where: {
          psychologistId,
          appointmentDate,
          status: AppointmentStatus.SCHEDULED,
          startMinute: {
            lt: endMinute,
          },
          endMinute: {
            gt: startMinute,
          },
        },
        select: {
          id: true,
        },
      });

      if (psychologistConflict) {
        throw new ConflictException(
          'El psicólogo ya tiene otra cita programada en ese horario.',
        );
      }

      const patientConflict = await tx.appointment.findFirst({
        where: {
          patientId: patient.id,
          appointmentDate,
          status: AppointmentStatus.SCHEDULED,
          startMinute: {
            lt: endMinute,
          },
          endMinute: {
            gt: startMinute,
          },
        },
        select: {
          id: true,
        },
      });

      if (patientConflict) {
        throw new ConflictException(
          'Ya tienes otra cita agendada en ese horario.',
        );
      }

      const created = await tx.appointment.create({
        data: {
          patientId: patient.id,
          psychologistId,
          appointmentDate,
          startMinute,
          endMinute,
          status: AppointmentStatus.SCHEDULED,
        },
        select: {
          id: true,
          patientId: true,
          psychologistId: true,
          appointmentDate: true,
          startMinute: true,
          endMinute: true,
          status: true,
          createdAt: true,
        },
      });

      return {
        id: created.id,
        appointmentDate: created.appointmentDate,
        startTime: this.minutesToTime(created.startMinute),
        endTime: this.minutesToTime(created.endMinute),
        status: created.status,
        psychologist: {
          id: psychologist.id,
          fullName:
            psychologist.staffProfile?.fullName ?? null,
        },
      };
    });
  }

  async getMine(patientUserId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: {
        userId: patientUserId,
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      throw new NotFoundException(
        'No se encontró el perfil del paciente.',
      );
    }

    const appointments = await this.prisma.appointment.findMany({
      where: {
        patientId: patient.id,
      },
      orderBy: [
        {
          appointmentDate: 'asc',
        },
        {
          startMinute: 'asc',
        },
      ],
      select: {
        id: true,
        appointmentDate: true,
        startMinute: true,
        endMinute: true,
        status: true,
        psychologist: {
          select: {
            id: true,
            staffProfile: {
              select: {
                fullName: true,
                position: true,
              },
            },
          },
        },
      },
    });

    return appointments.map((item) => ({
      id: item.id,
      appointmentDate: item.appointmentDate,
      startTime: this.minutesToTime(item.startMinute),
      endTime: this.minutesToTime(item.endMinute),
      status: item.status,
      psychologist: {
        id: item.psychologist.id,
        fullName:
          item.psychologist.staffProfile?.fullName ?? null,
        position:
          item.psychologist.staffProfile?.position ?? null,
      },
    }));
  }

  async cancel(
    patientUserId: string,
    appointmentId: string,
    dto: CancelAppointmentDto,
  ) {
    const patient = await this.prisma.patient.findUnique({
      where: {
        userId: patientUserId,
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      throw new NotFoundException(
        'No se encontró el perfil del paciente.',
      );
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      select: {
        id: true,
        patientId: true,
        status: true,
      },
    });

    if (!appointment || appointment.patientId !== patient.id) {
      throw new NotFoundException(
        'La cita no existe o no pertenece al paciente autenticado.',
      );
    }

    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new BadRequestException(
        'Solo una cita programada puede cancelarse.',
      );
    }

    const reason = dto.reason?.trim();

    const updated = await this.prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason || null,
      },
      select: {
        id: true,
        appointmentDate: true,
        startMinute: true,
        endMinute: true,
        status: true,
        cancelledAt: true,
        cancellationReason: true,
      },
    });

    return {
      id: updated.id,
      appointmentDate: updated.appointmentDate,
      startTime: this.minutesToTime(updated.startMinute),
      endTime: this.minutesToTime(updated.endMinute),
      status: updated.status,
      cancelledAt: updated.cancelledAt,
      cancellationReason: updated.cancellationReason,
    };
  }

  async reschedule(
    patientUserId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
  ) {
    const patient = await this.prisma.patient.findUnique({
      where: {
        userId: patientUserId,
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      throw new NotFoundException(
        'No se encontró el perfil del paciente.',
      );
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      select: {
        id: true,
        patientId: true,
        psychologistId: true,
        appointmentDate: true,
        startMinute: true,
        status: true,
      },
    });

    if (!appointment || appointment.patientId !== patient.id) {
      throw new NotFoundException(
        'La cita no existe o no pertenece al paciente autenticado.',
      );
    }

    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new BadRequestException(
        'Solo una cita programada puede reagendarse.',
      );
    }

    const newDate = this.normalizeCalendarDate(
      dto.appointmentDate,
    );
    const newStartMinute = this.timeToMinutes(dto.startTime);
    const newEndMinute = newStartMinute + APPOINTMENT_DURATION_MINUTES;

    this.assertFutureDateAndTime(newDate, newStartMinute);

    const availability = await this.hasAvailability(
      appointment.psychologistId,
      newDate,
      newStartMinute,
      newEndMinute,
    );

    if (!availability) {
      throw new BadRequestException(
        'El nuevo horario no está dentro de la disponibilidad activa del psicólogo.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const conflict = await tx.appointment.findFirst({
        where: {
          psychologistId: appointment.psychologistId,
          appointmentDate: newDate,
          status: AppointmentStatus.SCHEDULED,
          id: {
            not: appointment.id,
          },
          startMinute: {
            lt: newEndMinute,
          },
          endMinute: {
            gt: newStartMinute,
          },
        },
        select: {
          id: true,
        },
      });

      if (conflict) {
        throw new ConflictException(
          'El nuevo horario ya está ocupado por otra cita del psicólogo.',
        );
      }

      const patientConflict = await tx.appointment.findFirst({
        where: {
          patientId: patient.id,
          appointmentDate: newDate,
          status: AppointmentStatus.SCHEDULED,
          id: {
            not: appointment.id,
          },
          startMinute: {
            lt: newEndMinute,
          },
          endMinute: {
            gt: newStartMinute,
          },
        },
        select: {
          id: true,
        },
      });

      if (patientConflict) {
        throw new ConflictException(
          'Ya tienes otra cita programada en ese horario.',
        );
      }

      const updated = await tx.appointment.update({
        where: {
          id: appointment.id,
        },
        data: {
          appointmentDate: newDate,
          startMinute: newStartMinute,
          endMinute: newEndMinute,
          status: AppointmentStatus.SCHEDULED,
          cancelledAt: null,
          cancellationReason: null,
        },
        select: {
          id: true,
          appointmentDate: true,
          startMinute: true,
          endMinute: true,
          status: true,
        },
      });

      return {
        id: updated.id,
        appointmentDate: updated.appointmentDate,
        startTime: this.minutesToTime(updated.startMinute),
        endTime: this.minutesToTime(updated.endMinute),
        status: updated.status,
      };
    });
  }

  async getPsychologistAgenda(psychologistUserId: string) {
    const psychologist = await this.prisma.user.findUnique({
      where: {
        id: psychologistUserId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (
      !psychologist ||
      psychologist.role !== UserRole.PSYCHOLOGIST ||
      !psychologist.isActive
    ) {
      throw new ForbiddenException(
        'Solo un psicólogo activo puede consultar su agenda.',
      );
    }

    const appointments = await this.prisma.appointment.findMany({
      where: {
        psychologistId: psychologist.id,
      },
      orderBy: [
        {
          appointmentDate: 'asc',
        },
        {
          startMinute: 'asc',
        },
      ],
      select: {
        id: true,
        appointmentDate: true,
        startMinute: true,
        endMinute: true,
        status: true,
        patient: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    return appointments.map((item) => ({
      id: item.id,
      appointmentDate: item.appointmentDate,
      startTime: this.minutesToTime(item.startMinute),
      endTime: this.minutesToTime(item.endMinute),
      status: item.status,
      patient: {
        id: item.patient.id,
        fullName: item.patient.fullName ?? null,
      },
    }));
  }

  async getAvailableSlots(
    authenticatedUserId: string,
    psychologistId: string,
    date: string,
  ) {
    if (!psychologistId?.trim()) {
      throw new BadRequestException(
        'Debe indicarse psychologistId.',
      );
    }

    const doNotUsePatientIdentity = await this.prisma.user.findUnique({
      where: {
        id: authenticatedUserId,
      },
      select: {
        role: true,
      },
    });

    if (
      !doNotUsePatientIdentity ||
      !(
        doNotUsePatientIdentity.role === UserRole.PATIENT ||
        doNotUsePatientIdentity.role === UserRole.PSYCHOLOGIST
      )
    ) {
      throw new ForbiddenException(
        'No tienes permisos para consultar horarios disponibles.',
      );
    }

    const psychologist = await this.prisma.user.findUnique({
      where: {
        id: psychologistId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (
      !psychologist ||
      psychologist.role !== UserRole.PSYCHOLOGIST ||
      !psychologist.isActive
    ) {
      throw new NotFoundException(
        'El psicólogo no existe o no está activo.',
      );
    }

    const normalizedDate = this.normalizeCalendarDate(date);
    const dayOfWeek = this.getWeekDayFromDate(normalizedDate);
    const availabilityBlocks = await this.prisma.psychologistAvailability.findMany({
      where: {
        psychologistId,
        dayOfWeek,
        isActive: true,
      },
      orderBy: {
        startMinute: 'asc',
      },
    });

    const occupied = await this.prisma.appointment.findMany({
      where: {
        psychologistId,
        appointmentDate: normalizedDate,
        status: AppointmentStatus.SCHEDULED,
      },
      select: {
        startMinute: true,
        endMinute: true,
      },
    });

    const currentBogotaDate = this.getBogotaDateString(new Date());
    const currentBogotaMinutes = this.getBogotaMinutes(new Date());

    const slots: string[] = [];

    for (const block of availabilityBlocks) {
      let slotStart = block.startMinute;

      while (
        slotStart + APPOINTMENT_DURATION_MINUTES <=
        block.endMinute
      ) {
        const slotEnd =
          slotStart + APPOINTMENT_DURATION_MINUTES;

        const isPastSlot =
          normalizedDate < currentBogotaDate ||
          (normalizedDate === currentBogotaDate &&
            slotStart < currentBogotaMinutes);

        const overlapsWithOccupancy = occupied.some(
          (appointment) =>
            slotStart < appointment.endMinute &&
            slotEnd > appointment.startMinute,
        );

        if (!isPastSlot && !overlapsWithOccupancy) {
          slots.push(this.minutesToTime(slotStart));
        }

        slotStart += APPOINTMENT_DURATION_MINUTES;
      }
    }

    return slots;
  }

  private normalizeCalendarDate(date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException(
        'La fecha debe tener formato YYYY-MM-DD.',
      );
    }

    const parsed = new Date(`${date}T00:00:00-05:00`);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        'La fecha no es válida.',
      );
    }

    return date;
  }

  private assertFutureDateAndTime(
    date: string,
    startMinute: number,
  ) {
    const now = new Date(
      new Date().toLocaleString('en-US', {
        timeZone: BUSINESS_TIMEZONE,
      }),
    );

    const today = this.getBogotaDateString(now);
    const currentMinutes = this.getBogotaMinutes(now);

    if (date < today) {
      throw new BadRequestException(
        'La fecha de la cita no puede ser anterior a hoy.',
      );
    }

    if (date === today && startMinute <= currentMinutes) {
      throw new BadRequestException(
        'La cita debe estar en el futuro.',
      );
    }
  }

  private async hasAvailability(
    psychologistId: string,
    appointmentDate: string,
    startMinute: number,
    endMinute: number,
  ): Promise<boolean> {
    const dayOfWeek = this.getWeekDayFromDate(appointmentDate);

    const availabilityBlocks = await this.prisma.psychologistAvailability.findMany({
      where: {
        psychologistId,
        dayOfWeek,
        isActive: true,
      },
      select: {
        startMinute: true,
        endMinute: true,
      },
    });

    return availabilityBlocks.some(
      (block) =>
        block.startMinute <= startMinute &&
        block.endMinute >= endMinute,
    );
  }

  private getWeekDayFromDate(date: string): WeekDay {
    const dayIndex = new Date(`${date}T12:00:00-05:00`).getDay();

    const mapping: Record<number, WeekDay> = {
      0: WeekDay.SUNDAY,
      1: WeekDay.MONDAY,
      2: WeekDay.TUESDAY,
      3: WeekDay.WEDNESDAY,
      4: WeekDay.THURSDAY,
      5: WeekDay.FRIDAY,
      6: WeekDay.SATURDAY,
    };

    return mapping[dayIndex];
  }

  private getBogotaDateString(date: Date): string {
    const dateAsString = date.toLocaleString('sv-SE', {
      timeZone: BUSINESS_TIMEZONE,
    });

    return dateAsString.slice(0, 10);
  }

  private getBogotaMinutes(date: Date): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const [hours, minutes] = formatter
      .format(date)
      .split(':')
      .map(Number);

    return hours * 60 + minutes;
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private minutesToTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${hours
      .toString()
      .padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}`;
  }
}
