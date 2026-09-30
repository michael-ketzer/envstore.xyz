import 'server-only';
import { z } from 'zod';
import { env } from '@/env';
import { ManagedKeyError, readJson } from './http';
import { type BindingContext } from './contracts';

type KeyBinding = {
  id: string;
  workspaceId: string;
  tenantId: string;
  environment: string;
  purpose: string;
};
const plaintext = z
  .string()
  .length(44)
  .refine((s) => {
    const bytes = Buffer.from(s, 'base64');
    const valid = bytes.length === 32 && bytes.toString('base64') === s;
    bytes.fill(0);
    return valid;
  });
const ciphertext = z
  .string()
  .max(2048)
  .regex(/^vault:v[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$/);
const generated = z.object({ data: z.object({ plaintext, ciphertext }) });
const decrypted = z.object({ data: z.object({ plaintext }) });
const keyInfo = z.object({
  data: z.object({
    type: z.literal('aes256-gcm96'),
    derived: z.literal(true),
    exportable: z.literal(false),
    allow_plaintext_backup: z.literal(false),
    deletion_allowed: z.literal(false),
    latest_version: z.number().int().positive(),
  }),
});

function binding(key: KeyBinding, context: BindingContext): string {
  // Include server-authorized isolation fields and sort every context entry.
  return Buffer.from(
    JSON.stringify([
      'tenantId' in context ? 'envstore-managed-key-v2' : 'envstore-managed-key-v1',
      key.workspaceId,
      key.id,
      key.tenantId,
      key.environment,
      key.purpose,
      Object.entries(context).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]),
  ).toString('base64');
}

async function call(path: string, body?: unknown, admin = false, unwrap = false): Promise<unknown> {
  try {
    const url = new URL(env.OPENBAO_URL!);
    // Development OpenBao may listen on loopback HTTP. No remote HTTP, even
    // in development, and no embedded credentials, queries, or redirects.
    const local =
      env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/${env.OPENBAO_TRANSIT_MOUNT}/${path}`;
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Vault-Token': (admin ? env.OPENBAO_ADMIN_TOKEN : env.OPENBAO_RUNTIME_TOKEN)!,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      // Discard backend error bodies; they are never logged or returned.
      void response.body?.cancel().catch(() => {});
      if (unwrap && response.status === 400)
        throw new ManagedKeyError(400, 'Invalid wrapped key or context.');
      throw new Error();
    }
    if (response.status === 204) return null;
    return await readJson(response.body, 16384);
  } catch (error) {
    if (error instanceof ManagedKeyError && error.message === 'Invalid wrapped key or context.')
      throw error;
    throw new ManagedKeyError(503, 'Managed key engine unavailable.');
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ManagedKeyError(503, 'Invalid key engine response.');
  return result.data;
}

export async function inspectKey(keyId: string): Promise<number> {
  return parse(keyInfo, await call(`keys/envstore-${keyId}`, undefined, true)).data.latest_version;
}

export async function provisionKey(keyId: string): Promise<number> {
  // Transit creation is idempotent and never replaces an existing key ring.
  await call(
    `keys/envstore-${keyId}`,
    {
      type: 'aes256-gcm96',
      derived: true,
      exportable: false,
      allow_plaintext_backup: false,
    },
    true,
  );
  return inspectKey(keyId);
}

export async function rotateKey(keyId: string): Promise<number> {
  await call(`keys/envstore-${keyId}/rotate`, {}, true);
  return inspectKey(keyId);
}

export async function generateDataKey(key: KeyBinding, context: BindingContext) {
  const { data } = parse(
    generated,
    await call(`datakey/plaintext/envstore-${key.id}`, {
      bits: 256,
      context: binding(key, context),
    }),
  );
  return {
    plaintextKey: data.plaintext,
    wrappedKey: `esmk1.openbao.${key.id}.${Buffer.from(data.ciphertext).toString('base64url')}`,
  };
}

export async function unwrapDataKey(key: KeyBinding, context: BindingContext, wrappedKey: string) {
  const parts = wrappedKey.split('.');
  const encoded = parts[3] ?? '';
  const decoded = Buffer.from(encoded, 'base64url');
  if (
    parts.length !== 4 ||
    parts[0] !== 'esmk1' ||
    parts[1] !== 'openbao' ||
    parts[2] !== key.id ||
    decoded.toString('base64url') !== encoded ||
    !ciphertext.safeParse(decoded.toString('utf8')).success
  ) {
    throw new ManagedKeyError(400, 'Invalid wrapped key or context.');
  }
  const { data } = parse(
    decrypted,
    await call(
      `decrypt/envstore-${key.id}`,
      {
        ciphertext: decoded.toString('utf8'),
        context: binding(key, context),
      },
      false,
      true,
    ),
  );
  return { plaintextKey: data.plaintext };
}
