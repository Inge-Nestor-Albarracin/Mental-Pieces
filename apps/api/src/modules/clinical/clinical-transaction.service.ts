import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ClinicalTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    duplicateMessage = 'La relación clínica ya está registrada.',
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: 'Serializable',
        });
      } catch (error: unknown) {
        if (error instanceof HttpException) throw error;
        if (error instanceof PrismaClientKnownRequestError) {
          if (error.code === 'P2034') {
            if (attempt < 2) continue;
            throw new ConflictException(
              'La operación entró en conflicto. Intenta de nuevo.',
            );
          }
          if (error.code === 'P2002') {
            throw new ConflictException(duplicateMessage);
          }
        }
        // Never expose/log a Prisma exception with a clinical query or its values.
        // Do not attach the original exception as a cause.
        throw new InternalServerErrorException(
          'No fue posible completar la operación clínica.',
        );
      }
    }
    throw new ConflictException(
      'La operación entró en conflicto. Intenta de nuevo.',
    );
  }
}
