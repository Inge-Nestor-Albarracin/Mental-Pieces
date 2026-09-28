import { PrismaService } from './prisma.service';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

describe('Database isolation enforced by Jest configuration', () => {
  it('blocks the production PrismaService constructor before dotenv or a connection', () => {
    expect(() => new PrismaService()).toThrow(
      'Real database access is forbidden',
    );
  });

  it('blocks the generated client and direct PostgreSQL drivers', () => {
    expect(() => new PrismaClient({ adapter: {} as PrismaPg })).toThrow(
      'Real database access is forbidden',
    );
    expect(
      () =>
        new PrismaPg({ connectionString: 'postgresql://invalid.invalid/test' }),
    ).toThrow('Real database access is forbidden');
    const { Pool } = jest.requireActual<{ Pool: new () => unknown }>('pg');
    expect(() => new Pool()).toThrow('Real database access is forbidden');
  });
});
