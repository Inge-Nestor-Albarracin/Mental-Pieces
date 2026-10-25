import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { isSerializationFailure } from './serialization-failure';

describe('isSerializationFailure', () => {
  it('recognises Prisma P2034', () => {
    const error = new PrismaClientKnownRequestError('conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    expect(isSerializationFailure(error)).toBe(true);
  });

  it('recognises the pg driver adapter form (observed against PostgreSQL 18)', () => {
    const error = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
    });
    expect(isSerializationFailure(error)).toBe(true);
  });

  it('ignores other database errors', () => {
    const unique = new PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(isSerializationFailure(unique)).toBe(false);
    expect(isSerializationFailure(new Error('boom'))).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
    expect(
      isSerializationFailure({ cause: { kind: 'UniqueConstraintViolation' } }),
    ).toBe(false);
  });
});
