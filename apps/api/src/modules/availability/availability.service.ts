import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  UserRole,
  WeekDay,
} from '../../../generated/prisma/client';

import {
  PrismaService,
} from '../../database/prisma.service';

import {
  CreateAvailabilityDto,
} from './dto/create-availability.dto';

const DAY_ORDER: Record<WeekDay, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    psychologistId: string,
    dto: CreateAvailabilityDto,
  ) {
    await this.validatePsychologist(
      psychologistId,
    );

    const startMinute =
      this.timeToMinutes(dto.startTime);

    const endMinute =
      this.timeToMinutes(dto.endTime);

    if (startMinute >= endMinute) {
      throw new BadRequestException(
        'La hora de finalización debe ser posterior a la hora de inicio.',
      );
    }

    const overlapping =
      await this.prisma
        .psychologistAvailability
        .findFirst({
          where: {
            psychologistId,
            dayOfWeek: dto.dayOfWeek,
            isActive: true,

            startMinute: {
              lt: endMinute,
            },

            endMinute: {
              gt: startMinute,
            },
          },
        });

    if (overlapping) {
      throw new ConflictException(
        'Este horario se superpone con otro bloque de disponibilidad.',
      );
    }

    const availability =
      await this.prisma
        .psychologistAvailability
        .create({
          data: {
            psychologistId,
            dayOfWeek:
              dto.dayOfWeek,
            startMinute,
            endMinute,
          },
        });

    return this.formatAvailability(
      availability,
    );
  }

  async getMine(
    psychologistId: string,
  ) {
    await this.validatePsychologist(
      psychologistId,
    );

    const availability =
      await this.prisma
        .psychologistAvailability
        .findMany({
          where: {
            psychologistId,
            isActive: true,
          },
        });

    return availability
      .sort((a, b) => {
        const dayDifference =
          DAY_ORDER[a.dayOfWeek] -
          DAY_ORDER[b.dayOfWeek];

        if (dayDifference !== 0) {
          return dayDifference;
        }

        return (
          a.startMinute -
          b.startMinute
        );
      })
      .map((item) =>
        this.formatAvailability(item),
      );
  }

  async getForPsychologist(
    psychologistId: string,
  ) {
    const psychologist =
      await this.prisma.user.findFirst({
        where: {
          id: psychologistId,
          role:
            UserRole.PSYCHOLOGIST,
          isActive: true,
        },

        select: {
          id: true,

          staffProfile: {
            select: {
              fullName: true,
              position: true,
            },
          },
        },
      });

    if (!psychologist) {
      throw new NotFoundException(
        'Psicólogo no encontrado.',
      );
    }

    const availability =
      await this.prisma
        .psychologistAvailability
        .findMany({
          where: {
            psychologistId,
            isActive: true,
          },
        });

    const formatted =
      availability
        .sort((a, b) => {
          const dayDifference =
            DAY_ORDER[a.dayOfWeek] -
            DAY_ORDER[b.dayOfWeek];

          if (dayDifference !== 0) {
            return dayDifference;
          }

          return (
            a.startMinute -
            b.startMinute
          );
        })
        .map((item) =>
          this.formatAvailability(
            item,
          ),
        );

    return {
      psychologist: {
        id: psychologist.id,
        fullName:
          psychologist.staffProfile
            ?.fullName ?? null,
        position:
          psychologist.staffProfile
            ?.position ?? null,
      },

      availability: formatted,
    };
  }

  async remove(
    psychologistId: string,
    availabilityId: string,
  ) {
    const availability =
      await this.prisma
        .psychologistAvailability
        .findFirst({
          where: {
            id: availabilityId,
            psychologistId,
          },
        });

    if (!availability) {
      throw new NotFoundException(
        'Bloque de disponibilidad no encontrado.',
      );
    }

    await this.prisma
      .psychologistAvailability
      .delete({
        where: {
          id: availability.id,
        },
      });

    return {
      message:
        'Bloque de disponibilidad eliminado correctamente.',
    };
  }

  private async validatePsychologist(
    psychologistId: string,
  ) {
    const psychologist =
      await this.prisma.user.findUnique({
        where: {
          id: psychologistId,
        },

        select: {
          role: true,
          isActive: true,
        },
      });

    if (
      !psychologist ||
      psychologist.role !==
        UserRole.PSYCHOLOGIST ||
      !psychologist.isActive
    ) {
      throw new ForbiddenException(
        'El usuario no está habilitado como psicólogo.',
      );
    }
  }

  private timeToMinutes(
    time: string,
  ): number {
    const [hours, minutes] =
      time.split(':').map(Number);

    return hours * 60 + minutes;
  }

  private minutesToTime(
    totalMinutes: number,
  ): string {
    const hours = Math.floor(
      totalMinutes / 60,
    );

    const minutes =
      totalMinutes % 60;

    return `${hours
      .toString()
      .padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}`;
  }

  private formatAvailability(
    availability: {
      id: string;
      dayOfWeek: WeekDay;
      startMinute: number;
      endMinute: number;
      isActive: boolean;
    },
  ) {
    return {
      id: availability.id,
      dayOfWeek:
        availability.dayOfWeek,

      startTime:
        this.minutesToTime(
          availability.startMinute,
        ),

      endTime:
        this.minutesToTime(
          availability.endMinute,
        ),

      isActive:
        availability.isActive,
    };
  }
}