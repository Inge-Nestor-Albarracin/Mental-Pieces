import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

import { ConsentSource, UserRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DATA_POLICY_PURPOSE, policyToAccept } from '../legal/data-policy';
import { CreatePatientUserDto } from './dto/create-patient-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmailForAuth(email: string) {
    const normalizedEmail = email.trim().toLowerCase();

    return this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        isActive: true,
      },
    });
  }

  async createPatientUser(dto: CreatePatientUserDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'Ya existe un usuario registrado con este correo electrónico.',
      );
    }

    // Fail fast (before the costly hash) when the policy is not published or
    // the accepted version is not the current one.
    await policyToAccept(this.prisma, dto.dataPolicyVersion);

    const passwordHash = await hash(dto.password, 12);
    const mrn = this.generateMrn();

    // User, empty patient profile and acceptance evidence in one transaction:
    // either all three exist or none does. The policy version is re-checked
    // inside it, and the acceptance time is set by the database.
    return this.prisma
      .$transaction(async (tx) => {
        const policy = await policyToAccept(tx, dto.dataPolicyVersion);
        return tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: UserRole.PATIENT,

            patientProfile: {
              create: {
                mrn,
              },
            },

            dataConsents: {
              create: {
                documentId: policy.id,
                purpose: DATA_POLICY_PURPOSE,
                source: ConsentSource.PATIENT_REGISTRATION,
                documentVersion: policy.version,
                documentSha256: policy.sha256,
              },
            },
          },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,

            patientProfile: {
              select: {
                mrn: true,
              },
            },
          },
        });
      })
      .catch((error: unknown) => {
        // Two concurrent sign-ups with the same email: 409, never a 500.
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'Ya existe un usuario registrado con este correo electrónico.',
          );
        }
        throw error;
      });
  }

  private generateMrn(): string {
    const year = new Date().getUTCFullYear();

    const randomPart = randomBytes(8).toString('hex').toUpperCase();

    return `MP-${year}-${randomPart}`;
  }
}
