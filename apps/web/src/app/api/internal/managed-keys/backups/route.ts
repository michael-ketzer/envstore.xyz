import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '@/env';
import { presignManagedKeyBackup, presignGet, headObject } from '@/lib/r2';
import { rateLimit } from '@/lib/rate-limit';
import { ManagedKeyError, errorResponse, json, requestJson } from '@/lib/managed-keys/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const size = z
  .number()
  .int()
  .min(1)
  .max(128 * 1024 * 1024);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const ticketSchema = z
  .object({
    key: z
      .string()
      .regex(/^managed-key-backups\/media-server\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.tar\.age$/),
    sizeBytes: size,
    sha256Hex: digest,
    expires: z.number().int(),
  })
  .strict();
const inputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('prepare'), sizeBytes: size, sha256Hex: digest }).strict(),
  z.object({ operation: z.literal('verify'), ticket: z.string().max(2048) }).strict(),
]);

function equal(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
function sign(payload: string): string {
  // The upload bearer is held by the backup host. It must not be able to
  // forge tickets granting read access to historical snapshots.
  return createHmac('sha256', env.AUTH_SECRET)
    .update('envstore-openbao-backup-ticket-v1\0')
    .update(payload)
    .digest('base64url');
}

// This credential can write new encrypted snapshots only. It cannot choose
// arbitrary R2 keys, list historical snapshots, or delete any objects.
export async function POST(req: Request): Promise<Response> {
  try {
    if (!env.OPENBAO_BACKUP_TOKEN)
      throw new ManagedKeyError(503, 'Backup service is not configured.');
    const secure = env.MANAGED_KEYS_TRUST_PROXY
      ? req.headers.get('x-forwarded-proto') === 'https'
      : new URL(req.url).protocol === 'https:';
    if (!secure) throw new ManagedKeyError(400, 'HTTPS is required.');
    if (!equal(req.headers.get('authorization') ?? '', `Bearer ${env.OPENBAO_BACKUP_TOKEN}`))
      throw new ManagedKeyError(401, 'Not authenticated.');
    if (!rateLimit('managed-key-backups', { limit: 30, windowSec: 3600 }).success)
      throw new ManagedKeyError(429, 'Too many backup requests.');
    const parsed = inputSchema.safeParse(await requestJson(req));
    if (!parsed.success) throw new ManagedKeyError(400, 'Invalid backup request.');
    if (parsed.data.operation === 'prepare') {
      const key = `managed-key-backups/media-server/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.tar.age`;
      const payload = Buffer.from(
        JSON.stringify({
          key,
          sizeBytes: parsed.data.sizeBytes,
          sha256Hex: parsed.data.sha256Hex,
          expires: Date.now() + 3600000,
        }),
      ).toString('base64url');
      const upload = await presignManagedKeyBackup(key, { ...parsed.data, expiresIn: 300 });
      return json({ key, ticket: `${payload}.${sign(payload)}`, upload });
    }
    const [payload, signature, extra] = parsed.data.ticket.split('.');
    if (!payload || !signature || extra !== undefined || !equal(sign(payload), signature))
      throw new ManagedKeyError(400, 'Invalid backup ticket.');
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new ManagedKeyError(400, 'Invalid backup ticket.');
    }
    const ticket = ticketSchema.safeParse(value);
    if (!ticket.success || ticket.data.expires <= Date.now())
      throw new ManagedKeyError(400, 'Invalid backup ticket.');
    const object = await headObject(ticket.data.key);
    if (!object || object.contentLength !== ticket.data.sizeBytes)
      throw new ManagedKeyError(409, 'Backup upload is incomplete.');
    // Short-lived read access to THIS newly uploaded object permits the host
    // to download and hash-verify the durable copy before marking success.
    const download = await presignGet(ticket.data.key, { expiresIn: 300 });
    return json({ key: ticket.data.key, sha256Hex: ticket.data.sha256Hex, download });
  } catch (error) {
    return errorResponse(error);
  }
}
