// Singleton Prisma client. Reused across Next.js HMR/dev restarts to avoid
// exhausting Neon connections.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 requires a driver adapter for the runtime client. We use
// @prisma/adapter-pg (node-postgres under the hood) — works for any Postgres
// including Neon over its TCP endpoint. Self-hosters on different Postgres
// providers don't need to do anything to swap.
function makeClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Prisma 7 requires it at runtime for the pg adapter.',
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
export { Prisma } from '@prisma/client';
