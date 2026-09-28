import {
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { PrismaService } from '../../database/prisma.service';
import { ClinicalTransactionService } from './clinical-transaction.service';

describe('Clinical transactions', () => {
  const transaction = jest.fn();
  const service = new ClinicalTransactionService({
    $transaction: transaction,
  } as unknown as PrismaService);
  const operation = jest.fn();

  beforeEach(() => {
    transaction.mockReset();
    operation.mockReset();
  });

  it('retries serialization failures and keeps the serializable isolation level', async () => {
    transaction
      .mockRejectedValueOnce(
        new PrismaClientKnownRequestError('conflict', {
          code: 'P2034',
          clientVersion: '7.8.0',
        }),
      )
      .mockResolvedValueOnce({ id: 'synthetic' });
    await expect(service.run(operation)).resolves.toEqual({ id: 'synthetic' });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledWith(operation, {
      isolationLevel: 'Serializable',
    });
  });

  it('limits retries to three attempts and returns 409', async () => {
    transaction.mockRejectedValue(
      new PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '7.8.0',
      }),
    );
    await expect(service.run(operation)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry authorization failures', async () => {
    transaction.mockRejectedValue(
      new NotFoundException('Recurso clínico no encontrado.'),
    );
    await expect(service.run(operation)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('does not propagate query contents or an exception cause on storage failure', async () => {
    transaction.mockRejectedValue(new Error('synthetic-private-content'));
    await expect(service.run(operation)).rejects.toMatchObject({
      message: 'No fue posible completar la operación clínica.',
    });
    await expect(service.run(operation)).rejects.not.toHaveProperty('cause');
    await expect(service.run(operation)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
