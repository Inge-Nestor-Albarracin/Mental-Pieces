import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import {
  AppointmentStatus,
  ClinicalAuditAction,
  UserRole,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { formatAppointmentTime, hasAppointmentEnded } from './appointment-time';

type FinalStatus =
  | typeof AppointmentStatus.COMPLETED
  | typeof AppointmentStatus.NO_SHOW;

@Injectable()
export class AppointmentLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async finish(psychologistId: string, id: string, status: FinalStatus) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const appointment = await tx.appointment.findFirst({
              where: {
                id,
                psychologistId,
                psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
              },
              select: {
                id: true,
                appointmentDate: true,
                startMinute: true,
                endMinute: true,
                status: true,
              },
            });
            if (!appointment)
              throw new NotFoundException('Cita no encontrada.');
            if (appointment.status !== AppointmentStatus.SCHEDULED)
              throw new BadRequestException(
                'Solo una cita programada puede finalizarse.',
              );
            if (
              !hasAppointmentEnded(
                appointment.appointmentDate,
                appointment.endMinute,
              )
            )
              throw new BadRequestException(
                'La cita solo puede finalizarse después de su hora de finalización.',
              );

            const result = await tx.appointment.updateMany({
              where: {
                id,
                psychologistId,
                status: AppointmentStatus.SCHEDULED,
                // A reschedule after the read invalidates the temporal check as well.
                appointmentDate: appointment.appointmentDate,
                startMinute: appointment.startMinute,
                endMinute: appointment.endMinute,
                psychologist: { role: UserRole.PSYCHOLOGIST, isActive: true },
              },
              data: { status },
            });
            if (result.count !== 1)
              throw new BadRequestException(
                'La cita cambió y no puede finalizarse. Actualiza la agenda.',
              );
            await tx.auditLog.create({
              data: {
                actorUserId: psychologistId,
                action:
                  status === AppointmentStatus.COMPLETED
                    ? ClinicalAuditAction.APPOINTMENT_COMPLETED
                    : ClinicalAuditAction.APPOINTMENT_NO_SHOW,
                resourceType: 'Appointment',
                resourceId: id,
              },
              select: { id: true },
            });
            return {
              id: appointment.id,
              appointmentDate: appointment.appointmentDate,
              startTime: formatAppointmentTime(appointment.startMinute),
              endTime: formatAppointmentTime(appointment.endMinute),
              status,
            };
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (error instanceof HttpException) throw error;
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < 2) continue;
          throw new BadRequestException(
            'La cita cambió y no puede finalizarse. Actualiza la agenda.',
          );
        }
        // Never pass query values or patient data to Nest's exception logger.
        throw new InternalServerErrorException(
          'No fue posible finalizar la cita.',
        );
      }
    }
    throw new BadRequestException('No fue posible finalizar la cita.');
  }
}
