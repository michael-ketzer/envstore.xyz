import 'server-only';
import { prisma } from '@envstore/db';
import { rateLimit } from '@/lib/rate-limit';
import { keyIdSchema } from './contracts';
import { ManagedKeyError } from './http';

export type Actor = {
  workspaceId?: string;
  userId?: string;
  credentialId?: string;
  applicationId?: string;
};
export type Audit = Actor & { keyId?: string; targetCredentialId?: string; operation: string };

// An attempt is durable before touching the engine. A failed terminal audit
// write prevents key/credential delivery; the attempt remains for reconciliation.
// Attribution learned during the work (workspace, application, key, target) is
// written with the outcome.
export async function audited<T>(audit: Audit, work: () => Promise<T>): Promise<T> {
  const event = await prisma.managedKeyAuditEvent.create({
    data: { ...audit, outcome: 'attempted' },
  });
  const finish = (outcome: string) =>
    prisma.managedKeyAuditEvent.update({
      where: { id: event.id },
      data: {
        workspaceId: audit.workspaceId,
        applicationId: audit.applicationId,
        keyId: audit.keyId,
        targetCredentialId: audit.targetCredentialId,
        outcome,
      },
    });
  try {
    const result = await work();
    await finish('success');
    return result;
  } catch (error) {
    await finish(error instanceof ManagedKeyError && error.status < 500 ? 'denied' : 'error');
    throw error;
  }
}

export function throttle(actor: string, limit = 120): void {
  const result = rateLimit(`managed-keys:${actor}`, { limit, windowSec: 60 });
  if (!result.success) throw new ManagedKeyError(429, 'Too many managed key requests.');
}

export function parseId(id: string): string {
  const result = keyIdSchema.safeParse(id);
  if (!result.success) throw new ManagedKeyError(400, 'Invalid identifier.');
  return result.data;
}

export function bearer(req: Request): string | null {
  const value = req.headers.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}
