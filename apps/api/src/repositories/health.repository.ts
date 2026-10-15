import type { PrismaClient } from '../generated/prisma/client.js';
import type { DatabaseProbe } from './database-probe.js';

export class PrismaHealthProbe implements DatabaseProbe {
  constructor(private readonly prisma: PrismaClient) {}

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
