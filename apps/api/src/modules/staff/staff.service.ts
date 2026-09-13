import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { hash } from 'bcryptjs';

import {
  UserRole,
} from '../../../generated/prisma/client';

import { PrismaService } from '../../database/prisma.service';

import { CreateStaffUserDto } from './dto/create-staff-user.dto';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async createInternalUser(
    dto: CreateStaffUserDto,
  ) {
    const normalizedEmail =
      dto.email.trim().toLowerCase();

    const existingUser =
      await this.prisma.user.findUnique({
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

    const passwordHash =
      await hash(dto.password, 12);

    const fullName =
      dto.fullName.trim();

    const phone =
      dto.phone?.trim() || null;

    const position =
      dto.position?.trim() ||
      (dto.role === UserRole.PSYCHOLOGIST
        ? 'Psicólogo'
        : null);

    return this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: dto.role,

        staffProfile: {
          create: {
            fullName,
            phone,
            position,
          },
        },
      },

      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,

        staffProfile: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            position: true,
          },
        },
      },
    });
  }

  findActivePsychologists() {
    return this.prisma.staffProfile.findMany({
      where: {
        user: {
          role: UserRole.PSYCHOLOGIST,
          isActive: true,
        },
      },

      select: {
        id: true,
        fullName: true,
        position: true,

        user: {
          select: {
            id: true,
          },
        },
      },

      orderBy: {
        fullName: 'asc',
      },
    });
  }
}