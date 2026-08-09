import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Gender } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(userId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        mrn: true,
        fullName: true,
        birthDate: true,
        gender: true,
        genderOther: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!patient) {
      throw new NotFoundException(
        'No se encontró el perfil del paciente.',
      );
    }

    return {
      ...patient,
      isProfileComplete: this.isProfileComplete(patient),
    };
  }

  async updateMyProfile(
    userId: string,
    dto: UpdateMyProfileDto,
  ) {
    const currentPatient =
      await this.prisma.patient.findUnique({
        where: {
          userId,
        },
        select: {
          id: true,
          gender: true,
        },
      });

    if (!currentPatient) {
      throw new NotFoundException(
        'No se encontró el perfil del paciente.',
      );
    }

    if (dto.birthDate) {
      const birthDate = new Date(dto.birthDate);

      if (birthDate > new Date()) {
        throw new BadRequestException(
          'La fecha de nacimiento no puede estar en el futuro.',
        );
      }
    }

    let genderOther: string | null | undefined;

    if (dto.gender === Gender.OTHER) {
      if (!dto.genderOther?.trim()) {
        throw new BadRequestException(
          'Debes especificar el género seleccionado.',
        );
      }

      genderOther = dto.genderOther.trim();
    } else if (dto.gender) {
      genderOther = null;
    } else if (dto.genderOther !== undefined) {
      if (currentPatient.gender !== Gender.OTHER) {
        throw new BadRequestException(
          'El campo genderOther solo se puede usar cuando el género es OTHER.',
        );
      }

      genderOther = dto.genderOther.trim();
    }

    const patient = await this.prisma.patient.update({
      where: {
        userId,
      },
      data: {
        fullName:
          dto.fullName !== undefined
            ? dto.fullName.trim()
            : undefined,

        birthDate:
          dto.birthDate !== undefined
            ? new Date(dto.birthDate)
            : undefined,

        gender: dto.gender,

        genderOther,

        phone:
          dto.phone !== undefined
            ? dto.phone.trim()
            : undefined,
      },
      select: {
        id: true,
        mrn: true,
        fullName: true,
        birthDate: true,
        gender: true,
        genderOther: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...patient,
      isProfileComplete: this.isProfileComplete(patient),
    };
  }

  private isProfileComplete(patient: {
    fullName: string | null;
    birthDate: Date | null;
    gender: Gender | null;
    genderOther: string | null;
    phone: string | null;
  }): boolean {
    return Boolean(
      patient.fullName &&
        patient.birthDate &&
        patient.gender &&
        patient.phone &&
        (
          patient.gender !== Gender.OTHER ||
          patient.genderOther
        ),
    );
  }
}