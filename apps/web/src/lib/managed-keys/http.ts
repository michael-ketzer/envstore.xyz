import 'server-only';
import { env, features } from '@/env';

export class ManagedKeyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function errorResponse(error: unknown): Response {
  // Never propagate errors from fetch, Prisma, or validation: they can carry
  // request/response bodies. No error causes, console logs, or tracing here.
  return error instanceof ManagedKeyError
    ? json({ error: error.message }, error.status)
    : json({ error: 'Managed key service unavailable.' }, 503);
}

export function requireService(req: Request): void {
  const secure = env.MANAGED_KEYS_TRUST_PROXY
    ? req.headers.get('x-forwarded-proto') === 'https'
    : new URL(req.url).protocol === 'https:';
  if (!secure) throw new ManagedKeyError(400, 'HTTPS is required.');
  if (!features.managedKeys)
    throw new ManagedKeyError(503, 'Managed key service is not configured.');
}

// Bound bytes actually consumed, including chunked bodies, and bound idle reads.
export async function readJson(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = 16384,
  timeoutMs = 5000,
): Promise<unknown> {
  if (!body) throw new ManagedKeyError(400, 'Invalid JSON body.');
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ManagedKeyError(408, 'Request timed out.'));
        void reader.cancel().catch(() => {});
      }, timeoutMs);
    });
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new ManagedKeyError(413, 'Request body is too large.');
      chunks.push(next.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ManagedKeyError(400, 'Invalid JSON body.');
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function requestJson(req: Request): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ManagedKeyError(415, 'Content-Type must be application/json.');
  }
  return readJson(req.body);
}
