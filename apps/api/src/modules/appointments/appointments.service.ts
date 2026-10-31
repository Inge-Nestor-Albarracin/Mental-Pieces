import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

import type { Prisma } from '../../../generated/prisma/client';
import { AppointmentStatus, UserRole } from '../../../generated/prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { isSerializationFailure } from '../../database/serialization-failure';

import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

import { CreateAppointmentDto } from './dto/create-appointment.dto';

import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

import {
  businessNow,
  hasAppointmentStarted,
  isCalendarDate,
  weekDayOf,
} from './appointment-time';
import {
  assertPatientCanBook,
  DATA_POLICY_REQUIRED_MESSAGE,
  MINOR_BOOKING_MESSAGE,
  PROFILE_INCOMPLETE_MESSAGE,
} from '../patients/patient-requirements';
import {
  enqueueAppointmentBooked,
  enqueueAppointmentCancelled,
  enqueueAppointmentRescheduled,
} from '../notifications/notification-outbox';
import { PushDispatcher } from '../push/push-dispatcher';
import type { StaffCreateAppointmentDto } from './dto/staff-create-appointment.dto';

const APPOINTMENT_DURATION_MINUTES = 60;
// Anti-abuse: one patient cannot block a psychologist's whole schedule.
export const MAX_UPCOMING_APPOINTMENTS_PER_PATIENT = 4;
const PAST_APPOINTMENT_MESSAGE =
  'No puedes agendar una cita en una fecha u hora pasada.';
const NOT_MODIFIABLE_MESSAGE =
  'Solo una cita programada que aún no ha comenzado puede modificarse.';
const SLOT_TAKEN_MESSAGE =
  'Ese horario acaba de ser reservado. Elige otro horario.';
// Attempts for a booking transaction that PostgreSQL aborted as a serialization conflict.
const BOOKING_ATTEMPTS = 3;

// Same rules, worded for reception staff booking on a patient's behalf.
const STAFF_REQUIREMENT_MESSAGES: Record<string, string> = {
  [PROFILE_INCOMPLETE_MESSAGE]:
    'El paciente debe completar su perfil (nombre, fecha de nacimiento, género y teléfono) antes de agendar.',
  [DATA_POLICY_REQUIRED_MESSAGE]:
    'El paciente aún no ha aceptado la Política de Tratamiento de Datos Personales. Debe ingresar a la aplicación y aceptarla antes de agendar.',
  [MINOR_BOOKING_MESSAGE]:
    'No es posible agendar en línea citas para menores de 18 años.',
};

interface BookingRequest {
  patientId: string;
  patientUserId: string;
  // Staff member booking on the patient's behalf; undefined when the patient books.
  bookedByUserId?: string;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushDispatcher,
  ) {}

  async create(patientUserId: string, dto: CreateAppointmentDto) {
    const patient = await this.prisma.patient.findUnique({
      where: {
        userId: patientUserId,
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      throw new NotFoundException('No se encontró el perfil del paciente.');
    }

    return this.book({ patientId: patient.id, patientUserId }, dto);
  }

  // Reception (STAFF) books for a patient. Same availability, conflict, limit and
  // profile/consent rules as the patient's own booking, in the same transaction.
  async createForPatient(staffUserId: string, dto: StaffCreateAppointmentDto) {
    const staff = await this.prisma.user.findUnique({
      where: { id: staffUserId },
      select: { role: true, isActive: true },
    });
    if (!staff || staff.role !== UserRole.STAFF || !staff.isActive) {
      throw new ForbiddenException(
        'Solo el personal activo puede agendar citas para pacientes.',
      );
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
      select: { id: true, userId: true, user: { select: { isActive: true } } },
    });
    if (!patient || !patient.user.isActive) {
      throw new NotFoundException('El paciente no existe o no está activo.');
    }

    return this.book(
      {
        patientId: patient.id,
        patientUserId: patient.userId,
        bookedByUserId: staffUserId,
      },
      dto,
    );
  }

  private async book(request: BookingRequest, dto: CreateAppointmentDto) {
    const { patientUserId, bookedByUserId } = request;
    const patient = { id: request.patientId };
    const byStaff = bookedByUserId !== undefined;

    const psychologistId = dto.psychologistId.trim();
    const appointmentDate = this.normalizeCalendarDate(dto.appointmentDate);
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
      throw new NotFoundException('El psicólogo no existe o no está activo.');
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

    const booked = await this.runBookingTransaction(async (tx) => {
      // Complete profile, accepted data policy and adult age, read from PostgreSQL
      // in the same serializable transaction as the booking (never from the client).
      try {
        await assertPatientCanBook(tx, patientUserId);
      } catch (error: unknown) {
        const staffMessage =
          byStaff && error instanceof ConflictException
            ? STAFF_REQUIREMENT_MESSAGES[error.message]
            : undefined;
        if (staffMessage) throw new ConflictException(staffMessage);
        throw error;
      }

      const upcoming = await tx.appointment.count({
        where: {
          patientId: patient.id,
          status: AppointmentStatus.SCHEDULED,
          appointmentDate: { gte: businessNow().date },
        },
      });

      if (upcoming >= MAX_UPCOMING_APPOINTMENTS_PER_PATIENT) {
        throw new ConflictException(
          byStaff
            ? `El paciente ya tiene ${MAX_UPCOMING_APPOINTMENTS_PER_PATIENT} citas programadas. Debe cancelarse una o esperar a que se realice para agendar otra.`
            : `Ya tienes ${MAX_UPCOMING_APPOINTMENTS_PER_PATIENT} citas programadas. Cancela una o espera a que se realice para agendar otra.`,
        );
      }

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
          byStaff
            ? 'El paciente ya tiene otra cita agendada en ese horario.'
            : 'Ya tienes otra cita agendada en ese horario.',
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
          bookedByUserId: bookedByUserId ?? null,
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

      // Outbox in the same transaction: no notification exists unless the booking commits.
      await enqueueAppointmentBooked(
        tx,
        {
          appointmentId: created.id,
          patientUserId,
          psychologistUserId: created.psychologistId,
          appointmentDate: created.appointmentDate,
          startMinute: created.startMinute,
        },
        new Date(),
        bookedByUserId,
      );

      return {
        id: created.id,
        appointmentDate: created.appointmentDate,
        startTime: this.minutesToTime(created.startMinute),
        endTime: this.minutesToTime(created.endMinute),
        status: created.status,
        psychologist: {
          id: psychologist.id,
          fullName: psychologist.staffProfile?.fullName ?? null,
        },
      };
    });
    // Committed: send the queued pushes now instead of waiting for cron.
    this.push.kick();
    return booked;
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
      throw new NotFoundException('No se encontró el perfil del paciente.');
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
        fullName: item.psychologist.staffProfile?.fullName ?? null,
        position: item.psychologist.staffProfile?.position ?? null,
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
      throw new NotFoundException('No se encontró el perfil del paciente.');
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      select: {
        id: true,
        patientId: true,
        status: true,
        appointmentDate: true,
        startMinute: true,
      },
    });

    if (!appointment || appointment.patientId !== patient.id) {
      throw new NotFoundException(
        'La cita no existe o no pertenece al paciente autenticado.',
      );
    }

    if (
      appointment.status !== AppointmentStatus.SCHEDULED ||
      hasAppointmentStarted(
        appointment.appointmentDate,
        appointment.startMinute,
      )
    ) {
      throw new BadRequestException(NOT_MODIFIABLE_MESSAGE);
    }

    const reason = dto.reason?.trim();

    const updated = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.appointment.update({
          where: {
            id: appointment.id,
            patientId: patient.id,
            status: AppointmentStatus.SCHEDULED,
            // A reschedule after the read invalidates the temporal check.
            appointmentDate: appointment.appointmentDate,
            startMinute: appointment.startMinute,
          },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: reason || null,
          },
          select: {
            id: true,
            psychologistId: true,
            appointmentDate: true,
            startMinute: true,
            endMinute: true,
            status: true,
            cancelledAt: true,
            cancellationReason: true,
          },
        });
        // Same transaction: pending reminders are dropped and the cancellation queued.
        await enqueueAppointmentCancelled(tx, {
          appointmentId: row.id,
          patientUserId,
          psychologistUserId: row.psychologistId,
          appointmentDate: row.appointmentDate,
          startMinute: row.startMinute,
        });
        return row;
      })
      .catch((error: unknown) => {
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new BadRequestException(NOT_MODIFIABLE_MESSAGE);
        }
        throw error;
      });
    this.push.kick();

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
      throw new NotFoundException('No se encontró el perfil del paciente.');
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

    if (
      appointment.status !== AppointmentStatus.SCHEDULED ||
      hasAppointmentStarted(
        appointment.appointmentDate,
        appointment.startMinute,
      )
    ) {
      throw new BadRequestException(NOT_MODIFIABLE_MESSAGE);
    }

    const newDate = this.normalizeCalendarDate(dto.appointmentDate);
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

    const rescheduled = await this.runBookingTransaction(async (tx) => {
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
          patientId: patient.id,
          psychologistId: appointment.psychologistId,
          status: AppointmentStatus.SCHEDULED,
          appointmentDate: appointment.appointmentDate,
          startMinute: appointment.startMinute,
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

      // Old reminders are invalidated; the change and the new reminder are queued.
      await enqueueAppointmentRescheduled(tx, {
        appointmentId: updated.id,
        patientUserId,
        psychologistUserId: appointment.psychologistId,
        appointmentDate: updated.appointmentDate,
        startMinute: updated.startMinute,
      });

      return {
        id: updated.id,
        appointmentDate: updated.appointmentDate,
        startTime: this.minutesToTime(updated.startMinute),
        endTime: this.minutesToTime(updated.endMinute),
        status: updated.status,
      };
    }).catch((error: unknown) => {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new BadRequestException('La cita cambió y no puede reagendarse.');
      }
      throw error;
    });
    this.push.kick();
    return rescheduled;
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
      throw new BadRequestException('Debe indicarse psychologistId.');
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
        doNotUsePatientIdentity.role === UserRole.PSYCHOLOGIST ||
        doNotUsePatientIdentity.role === UserRole.STAFF
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
      throw new NotFoundException('El psicólogo no existe o no está activo.');
    }

    const normalizedDate = this.normalizeCalendarDate(date);
    const dayOfWeek = weekDayOf(normalizedDate);
    const availabilityBlocks =
      await this.prisma.psychologistAvailability.findMany({
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

    const current = businessNow();

    const slots: string[] = [];

    for (const block of availabilityBlocks) {
      let slotStart = block.startMinute;

      while (slotStart + APPOINTMENT_DURATION_MINUTES <= block.endMinute) {
        const slotEnd = slotStart + APPOINTMENT_DURATION_MINUTES;

        // Same rule as creation: a slot is offered only if it has not started.
        const isPastSlot =
          normalizedDate < current.date ||
          (normalizedDate === current.date && slotStart <= current.minute);

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

  // Booking reads "is the slot free?" and then writes. Under PostgreSQL's default
  // READ COMMITTED two simultaneous requests both saw the slot free and both inserted
  // (double booking, reproduced in test/integration). SERIALIZABLE makes PostgreSQL
  // abort one of them (40001); the retry then sees the other booking and answers 409.
  private async runBookingTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: 'Serializable',
        });
      } catch (error: unknown) {
        if (!isSerializationFailure(error)) throw error;
        if (attempt >= BOOKING_ATTEMPTS) {
          throw new ConflictException(SLOT_TAKEN_MESSAGE);
        }
      }
    }
  }

  private normalizeCalendarDate(date: string): string {
    if (typeof date !== 'string' || !isCalendarDate(date)) {
      throw new BadRequestException(
        'La fecha debe ser una fecha válida con formato YYYY-MM-DD.',
      );
    }

    return date;
  }

  // Server time in America/Bogota is the authority; the browser clock is UX only.
  private assertFutureDateAndTime(date: string, startMinute: number) {
    if (hasAppointmentStarted(date, startMinute)) {
      throw new BadRequestException(PAST_APPOINTMENT_MESSAGE);
    }
  }

  private async hasAvailability(
    psychologistId: string,
    appointmentDate: string,
    startMinute: number,
    endMinute: number,
  ): Promise<boolean> {
    const dayOfWeek = weekDayOf(appointmentDate);

    const availabilityBlocks =
      await this.prisma.psychologistAvailability.findMany({
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
        block.startMinute <= startMinute && block.endMinute >= endMinute,
    );
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private minutesToTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}`;
  }
}
