// Jest maps real database entry points here before importing application code.
// Services must receive explicit useValue fakes. Never instantiate this class.
export class PrismaService {
  constructor() {
    throw new Error('Real database access is forbidden in automated tests.');
  }
}

export { PrismaService as PrismaClient, PrismaService as PrismaPg };
export { PrismaService as Pool, PrismaService as Client };
export default PrismaService;
