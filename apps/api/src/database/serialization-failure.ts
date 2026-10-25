import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

// PostgreSQL aborts one of two conflicting SERIALIZABLE transactions (SQLSTATE 40001).
// Prisma reports it as P2034 or, with the pg driver adapter inside an interactive
// transaction, as a DriverAdapterError whose cause is TransactionWriteConflict / 40001.
export function isSerializationFailure(error: unknown): boolean {
  if (error instanceof PrismaClientKnownRequestError)
    return error.code === 'P2034';
  if (typeof error !== 'object' || error === null) return false;
  const cause = (
    error as { cause?: { kind?: unknown; originalCode?: unknown } }
  ).cause;
  return (
    cause?.kind === 'TransactionWriteConflict' ||
    cause?.originalCode === '40001'
  );
}
