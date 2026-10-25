import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { hash } from 'bcryptjs';

import type { Prisma } from '../../../generated/prisma/client';
import { UserRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';

export const STAFF_PAGE_SIZE = 20;

const INTERNAL_ROLES = [UserRole.PSYCHOLOGIST, UserRole.STAFF];

const EMAIL_TAKEN_MESSAGE =
  'Ya existe un usuario registrado con este correo electrónico.';

// Explicit allowlist: never passwordHash, never patient or clinical data.
const INTERNAL_USER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  staffProfile: {
    select: {
      fullName: true,
      phone: true,
      position: true,
    },
  },
} satisfies Prisma.UserSelect;

type InternalUserRow = Prisma.UserGetPayload<{
  select: typeof INTERNAL_USER_SELECT;
}>;

function toInternalUser(row: InternalUserRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    fullName: row.staffProfile?.fullName ?? null,
    phone: row.staffProfile?.phone ?? null,
    position: row.staffProfile?.position ?? null,
  };
}

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async createInternalUser(actorUserId: string, dto: CreateStaffUserDto) {
    // The JWT lives 15 minutes: re-check that the admin is still active.
    await this.assertActiveAdmin(actorUserId);

    const normalizedEmail = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hash(dto.password, 12);

    const position =
      dto.position?.trim() ||
      (dto.role === UserRole.PSYCHOLOGIST ? 'Psicólogo' : null);

    const created = await this.prisma.user
      .create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: dto.role,
          staffProfile: {
            create: {
              fullName: dto.fullName.trim(),
              phone: dto.phone?.trim() || null,
              position,
            },
          },
        },
        select: INTERNAL_USER_SELECT,
      })
      .catch((error: unknown) => {
        // Two concurrent requests with the same email: 409, never a 500.
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(EMAIL_TAKEN_MESSAGE);
        }
        throw error;
      });

    return toInternalUser(created);
  }

  async listInternalUsers(actorUserId: string, page: number) {
    await this.assertActiveAdmin(actorUserId);

    const rows = await this.prisma.user.findMany({
      where: { role: { in: INTERNAL_ROLES } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * STAFF_PAGE_SIZE,
      take: STAFF_PAGE_SIZE + 1,
      select: INTERNAL_USER_SELECT,
    });

    return {
      items: rows.slice(0, STAFF_PAGE_SIZE).map(toInternalUser),
      page,
      pageSize: STAFF_PAGE_SIZE,
      hasMore: rows.length > STAFF_PAGE_SIZE,
    };
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

  private async assertActiveAdmin(actorUserId: string): Promise<void> {
    const actor = await this.prisma.user.findFirst({
      where: { id: actorUserId, role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    if (!actor) {
      throw new ForbiddenException('No tienes permisos para esta operación.');
    }
  }
}
