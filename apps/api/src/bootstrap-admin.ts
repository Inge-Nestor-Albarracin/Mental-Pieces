import 'dotenv/config';

import { hash } from 'bcryptjs';

import {
  UserRole,
} from '../generated/prisma/client';

import {
  PrismaService,
} from '../src/database/prisma.service';

async function bootstrapAdmin() {
  const email =
    process.env.BOOTSTRAP_ADMIN_EMAIL
      ?.trim()
      .toLowerCase();

  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD;

  const fullName =
    process.env.BOOTSTRAP_ADMIN_NAME
      ?.trim();

  if (!email) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL no está definida.',
    );
  }

  if (!password) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD no está definida.',
    );
  }

  if (!fullName) {
    throw new Error(
      'BOOTSTRAP_ADMIN_NAME no está definida.',
    );
  }

  if (
    password.length < 8 ||
    password.length > 72
  ) {
    throw new Error(
      'La contraseña debe tener entre 8 y 72 caracteres.',
    );
  }

  const prisma =
    new PrismaService();

  try {
    await prisma.$connect();

    const existingUser =
      await prisma.user.findUnique({
        where: {
          email,
        },

        select: {
          id: true,
          email: true,
          role: true,
        },
      });

    if (existingUser) {
      throw new Error(
        `Ya existe un usuario con el correo ${existingUser.email}. No se modificó su rol.`,
      );
    }

    const passwordHash =
      await hash(password, 12);

    const admin =
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: UserRole.ADMIN,

          staffProfile: {
            create: {
              fullName,
              position:
                'Administrador',
            },
          },
        },

        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,

          staffProfile: {
            select: {
              fullName: true,
              position: true,
            },
          },
        },
      });

    console.log(
      'Administrador creado correctamente:',
    );

    console.log(admin);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrapAdmin().catch(
  (error: unknown) => {
    if (error instanceof Error) {
      console.error(
        `Error: ${error.message}`,
      );
    } else {
      console.error(
        'Ocurrió un error inesperado.',
      );
    }

    process.exitCode = 1;
  },
);