import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

import { ConsentSource, Gender } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { businessNow, isCalendarDate } from '../appointments/appointment-time';
import {
  DATA_POLICY_PURPOSE,
  currentDataPolicy,
  hasAcceptedDataPolicy,
  policyToAccept,
} from '../legal/data-policy';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import {
  DATA_POLICY_REQUIRED_MESSAGE,
  isProfileComplete,
  isValidPhone,
} from './patient-requirements';

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
        emailRemindersEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!patient) {
      throw new NotFoundException('No se encontró el perfil del paciente.');
    }

    const [dataPolicyAccepted, currentPolicy] = await Promise.all([
      hasAcceptedDataPolicy(this.prisma, userId),
      currentDataPolicy(this.prisma),
    ]);

    // Both flags are computed here from PostgreSQL; the client cannot set them.
    return {
      ...patient,
      isProfileComplete: isProfileComplete(patient),
      dataPolicyAccepted,
      currentDataPolicyVersion: currentPolicy?.version ?? null,
    };
  }

  // Explicit acceptance by an existing account (registered before the policy, or
  // after a version that requires a new authorisation). Never inferred. Accepting
  // the same version twice keeps the first record.
  async acceptDataPolicy(userId: string, dataPolicyVersion: string) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await policyToAccept(tx, dataPolicyVersion);
      const patient = await tx.patient.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!patient) {
        throw new NotFoundException('No se encontró el perfil del paciente.');
      }
      // Read, then insert: the evidence table is append-only (no upsert/UPDATE).
      const key = {
        userId,
        documentId: policy.id,
        purpose: DATA_POLICY_PURPOSE,
      };
      const consent =
        (await tx.dataProcessingConsent.findUnique({
          where: { userId_documentId_purpose: key },
          select: { documentVersion: true, acceptedAt: true },
        })) ??
        (await tx.dataProcessingConsent.create({
          data: {
            ...key,
            source: ConsentSource.EXISTING_ACCOUNT,
            documentVersion: policy.version,
            documentSha256: policy.sha256,
          },
          select: { documentVersion: true, acceptedAt: true },
        }));
      return {
        dataPolicyAccepted: true,
        dataPolicyVersion: consent.documentVersion,
        acceptedAt: consent.acceptedAt,
      };
    });
  }

  // Records the patient's own choice and when it was made (verifiable consent).
  async updateNotificationPreferences(userId: string, emailReminders: boolean) {
    const updated = await this.prisma.patient
      .update({
        where: { userId },
        data: {
          emailRemindersEnabled: emailReminders,
          emailRemindersUpdatedAt: new Date(),
        },
        select: { emailRemindersEnabled: true, emailRemindersUpdatedAt: true },
      })
      .catch((error: unknown) => {
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException('No se encontró el perfil del paciente.');
        }
        throw error;
      });
    return {
      emailReminders: updated.emailRemindersEnabled,
      updatedAt: updated.emailRemindersUpdatedAt,
    };
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    const currentPatient = await this.prisma.patient.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        gender: true,
      },
    });

    if (!currentPatient) {
      throw new NotFoundException('No se encontró el perfil del paciente.');
    }

    // Personal data is collected only after the data policy was accepted.
    if (!(await hasAcceptedDataPolicy(this.prisma, userId))) {
      throw new ConflictException(DATA_POLICY_REQUIRED_MESSAGE);
    }

    if (dto.birthDate !== undefined) {
      if (!isCalendarDate(dto.birthDate) || dto.birthDate < '1900-01-01') {
        throw new BadRequestException('La fecha de nacimiento no es válida.');
      }
      if (dto.birthDate > businessNow().date) {
        throw new BadRequestException(
          'La fecha de nacimiento no puede estar en el futuro.',
        );
      }
    }

    if (dto.phone !== undefined && !isValidPhone(dto.phone)) {
      throw new BadRequestException(
        'El teléfono debe tener entre 7 y 25 caracteres, con al menos 7 dígitos (se permiten espacios, +, -, paréntesis y puntos).',
      );
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
      if (!genderOther) {
        throw new BadRequestException(
          'Debes especificar el género seleccionado.',
        );
      }
    }

    const patient = await this.prisma.patient.update({
      where: {
        userId,
      },
      data: {
        fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,

        birthDate:
          dto.birthDate !== undefined
            ? new Date(`${dto.birthDate}T00:00:00.000Z`)
            : undefined,

        gender: dto.gender,

        genderOther,

        phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
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
      isProfileComplete: isProfileComplete(patient),
      dataPolicyAccepted: true,
    };
  }
}
