// Cloudflare R2 client + presigned URL helpers.
//
// R2 speaks the S3 API, so we use @aws-sdk/client-s3 with R2's endpoint. The
// CLI uploads ciphertext directly to R2 via a presigned PUT (avoiding our app
// server entirely); downloads use a presigned GET the same way. The server
// only ever issues signatures.
//
// Object-key scheme — uses IDs (immutable) not slugs (renameable):
//   workspaces/<workspaceId>/projects/<projectId>/environments/<envId>/versions/<versionId>

import 'server-only';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { LIMITS } from '@envstore/shared';

import { env, features } from '@/env';

let cachedClient: S3Client | null = null;

function r2Endpoint(): string {
  const j = env.R2_JURISDICTION;
  return j === 'default'
    ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : `https://${env.R2_ACCOUNT_ID}.${j}.r2.cloudflarestorage.com`;
}

function requireR2(): { bucket: string } {
  if (!features.r2) {
    throw new R2NotConfiguredError();
  }
  return { bucket: env.R2_BUCKET! };
}

export class R2NotConfiguredError extends Error {
  constructor() {
    super(
      'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.',
    );
    this.name = 'R2NotConfiguredError';
  }
}

function client(): S3Client {
  if (cachedClient) return cachedClient;
  requireR2();
  cachedClient = new S3Client({
    // R2 always accepts "auto" as the SigV4 region. Jurisdiction-restricted
    // buckets route via a different endpoint hostname (see r2Endpoint), not
    // a different region — passing the jurisdiction here (e.g. "eu") makes
    // R2 reject the request with InvalidRegionName.
    region: 'auto',
    endpoint: r2Endpoint(),
    forcePathStyle: false,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return cachedClient;
}

// Version numbers are monotonic per environment and never reused, so they
// form a stable key. We avoid using the row ID so callers don't need to
// pre-generate cuid()s.
export function buildVersionKey(opts: {
  workspaceId: string;
  projectId: string;
  environmentId: string;
  version: number;
}): string {
  return `workspaces/${opts.workspaceId}/projects/${opts.projectId}/environments/${opts.environmentId}/versions/v${opts.version}`;
}

export type PresignedPut = {
  url: string;
  /** Headers the client MUST send with the PUT — failing to do so will cause a 403 from R2. */
  requiredHeaders: Record<string, string>;
  /** Seconds until expiry. */
  expiresIn: number;
};

const DEFAULT_PUT_EXPIRY = 600; // 10 minutes
const DEFAULT_GET_EXPIRY = 300; // 5 minutes
const CIPHERTEXT_CONTENT_TYPE = 'application/octet-stream';

export async function presignPut(
  key: string,
  opts: { sizeBytes: number; sha256Hex?: string; expiresIn?: number },
): Promise<PresignedPut> {
  const { bucket } = requireR2();
  if (opts.sizeBytes < 1 || opts.sizeBytes > LIMITS.maxCiphertextBytes) {
    throw new Error(
      `presigned PUT must declare a size between 1 and ${LIMITS.maxCiphertextBytes} bytes`,
    );
  }
  // Sign with ContentType + ContentLength so R2 enforces them. The client must
  // echo these headers; presigned signatures bind them. Note: we don't pin
  // sha256 here — R2 does not enforce x-amz-checksum-* headers via presign.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: CIPHERTEXT_CONTENT_TYPE,
    ContentLength: opts.sizeBytes,
  });
  const url = await getSignedUrl(client(), command, {
    expiresIn: opts.expiresIn ?? DEFAULT_PUT_EXPIRY,
  });
  return {
    url,
    requiredHeaders: {
      'content-type': CIPHERTEXT_CONTENT_TYPE,
      'content-length': String(opts.sizeBytes),
    },
    expiresIn: opts.expiresIn ?? DEFAULT_PUT_EXPIRY,
  };
}

export async function presignGet(
  key: string,
  opts?: { expiresIn?: number },
): Promise<{ url: string; expiresIn: number }> {
  const { bucket } = requireR2();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const expiresIn = opts?.expiresIn ?? DEFAULT_GET_EXPIRY;
  const url = await getSignedUrl(client(), command, { expiresIn });
  return { url, expiresIn };
}

export type R2Object = { contentLength: number };

export async function headObject(key: string): Promise<R2Object | null> {
  const { bucket } = requireR2();
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (typeof res.ContentLength !== 'number') return null;
    return { contentLength: res.ContentLength };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}
