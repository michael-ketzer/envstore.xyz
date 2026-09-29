import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, prisma, type ManagedKey } from '@envstore/db';
import { audited, bearer, throttle, type Audit } from './common';
import {
  APPLICATION_TOKEN_PREFIX,
  PROVIDER,
  VERSION,
  applicationSchema,
  applicationUnwrapSchema,
  generateSchema,
  type BindingContext,
  type Operation,
} from './contracts';
import { ManagedKeyError, errorResponse, json, requestJson, requireService } from './http';
import * as engine from './openbao';
import { isJwt, verifyVercelToken, type VercelIdentity } from './vercel-oidc';

export type ApplicationAction = 'application.list' | 'application.register' | 'application.revoke';

const TOKEN = /^esma_[A-Za-z0-9_-]{43}$/;
const include = { workspace: { select: { slug: true, deletedAt: true } } } as const;
type Application = Prisma.ManagedKeyApplicationGetPayload<{ include: typeof include }>;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

function forbidden(): ManagedKeyError {
  return new ManagedKeyError(403, 'Key or context is not authorized.');
}

type KeyRequest = { context: BindingContext; stored?: { keyId: string; wrappedKey: string } };

function keyRequest(operation: Operation, body: unknown): KeyRequest {
  if (operation === 'generate') {
    const input = generateSchema.safeParse(body);
    if (input.success) return { context: input.data.context };
  } else {
    const input = applicationUnwrapSchema.safeParse(body);
    if (input.success) {
      const { context, keyId, wrappedKey } = input.data;
      return { context, stored: { keyId, wrappedKey } };
    }
  }
  throw new ManagedKeyError(400, 'Invalid key request.');
}

// Invalid tokens are unauthenticated callers; an unavailable key set is not.
async function vercelIdentity(token: string): Promise<VercelIdentity | null> {
  try {
    return await verifyVercelToken(token);
  } catch (error) {
    if (error instanceof ManagedKeyError && error.status === 401) return null;
    throw error;
  }
}

async function vercelApplication(
  workspaceSlug: string,
  identity: VercelIdentity,
  purpose: string,
): Promise<Application> {
  const matches = await prisma.managedKeyApplication.findMany({
    where: {
      workspace: { slug: workspaceSlug },
      vercelTeamId: identity.teamId,
      vercelProjectId: identity.projectId,
      vercelEnvironment: identity.environment,
      purpose,
      revokedAt: null,
    },
    include,
    take: 2,
  });
  // Registration refuses duplicates; ambiguity fails closed regardless.
  if (matches.length !== 1) throw forbidden();
  return matches[0]!;
}

function authorizeApplication(
  application: Application | null,
  workspaceSlug: string,
  context: BindingContext,
): asserts application is Application {
  if (
    !application ||
    application.revokedAt ||
    (application.expiresAt && application.expiresAt <= new Date()) ||
    application.workspace.deletedAt
  ) {
    throw new ManagedKeyError(401, 'Invalid application credential.');
  }
  if (application.workspace.slug !== workspaceSlug || application.purpose !== context.purpose) {
    throw forbidden();
  }
}

function authorizeKey(
  application: Application,
  key: ManagedKey | null,
  context: BindingContext,
): asserts key is ManagedKey {
  if (
    !key ||
    key.workspaceId !== application.workspaceId ||
    key.environment !== application.environment ||
    key.name !== application.keyName ||
    key.purpose !== application.purpose ||
    key.purpose !== context.purpose ||
    key.tenantId !== context.teamId
  ) {
    throw forbidden();
  }
  if (key.disabledAt || !key.provisionedAt) throw new ManagedKeyError(403, 'Key is unavailable.');
}

// The tenant's key for this application, created on first use. Creation never
// replaces, re-enables, or re-purposes an existing key.
async function tenantKey(application: Application, tenantId: string): Promise<ManagedKey> {
  const scope = {
    workspaceId: application.workspaceId,
    tenantId,
    environment: application.environment,
    name: application.keyName,
  };
  const where = { workspaceId_tenantId_environment_name: scope };
  let key = await prisma.managedKey.findUnique({ where });
  if (!key) {
    key = await prisma.$transaction(async (tx) => {
      // Serialize first use within this key space so the tenant limit holds
      // for concurrent requests. Postgres releases the lock with the transaction.
      const space = `managed-key-tenants:${scope.workspaceId}:${scope.environment}:${scope.name}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${space}))`;
      const existing = await tx.managedKey.findUnique({ where });
      if (existing) return existing;
      const tenants = await tx.managedKey.count({
        where: {
          workspaceId: scope.workspaceId,
          environment: scope.environment,
          name: scope.name,
        },
      });
      if (tenants >= application.maxTenants) {
        throw new ManagedKeyError(403, 'Application tenant limit reached.');
      }
      return tx.managedKey.upsert({
        where,
        create: { ...scope, purpose: application.purpose },
        update: {},
      });
    });
  }
  if (key.purpose !== application.purpose) throw forbidden();
  if (!key.provisionedAt && !key.disabledAt) {
    const id = key.id;
    await audited(
      {
        workspaceId: application.workspaceId,
        applicationId: application.id,
        keyId: id,
        operation: 'key.provision',
      },
      () => engine.provisionKey(id),
    );
    await prisma.managedKey.updateMany({
      where: { id, provisionedAt: null },
      data: { provisionedAt: new Date() },
    });
    key = await prisma.managedKey.findUnique({ where: { id } });
  }
  if (!key) throw forbidden();
  return key;
}

/**
 * Data keys for a registered application, authenticated as a Vercel deployment
 * (OIDC) or with a static `esma_` token. The tenant comes from `context.teamId`.
 */
export async function applicationRequest(
  req: Request,
  workspaceSlug: string,
  operation: Operation,
): Promise<Response> {
  try {
    requireService(req);
    const token = bearer(req);
    let identity: VercelIdentity | null = null;
    let tokenApplication: Application | null = null;
    if (token && TOKEN.test(token)) {
      tokenApplication = await prisma.managedKeyApplication.findUnique({
        where: { tokenHash: digest(token) },
        include,
      });
    } else if (token && isJwt(token)) {
      identity = await vercelIdentity(token);
    }
    // One application serves many tenants: a wider caller budget, and the
    // per-tenant budget of a tenant credential below.
    if (tokenApplication) throttle(`application:${tokenApplication.id}`, 1200);
    else if (identity) {
      throttle(`vercel:${identity.teamId}:${identity.projectId}:${identity.environment}`, 1200);
    } else throttle('anonymous');
    const audit: Audit = {
      workspaceId: tokenApplication?.workspaceId,
      applicationId: tokenApplication?.id,
      operation: `data-key.${operation}`,
    };
    return await audited(audit, async () => {
      if (!tokenApplication && !identity) {
        throw new ManagedKeyError(401, 'Invalid application credential.');
      }
      const { context, stored } = keyRequest(operation, await requestJson(req));
      const application =
        tokenApplication ?? (await vercelApplication(workspaceSlug, identity!, context.purpose));
      audit.workspaceId = application.workspaceId;
      audit.applicationId = application.id;
      authorizeApplication(application, workspaceSlug, context);
      throttle(`application:${application.id}:${context.teamId}`);
      const key = stored
        ? await prisma.managedKey.findFirst({
            where: { id: stored.keyId, workspaceId: application.workspaceId },
          })
        : await tenantKey(application, context.teamId);
      audit.keyId = key?.id;
      authorizeKey(application, key, context);
      const material = stored
        ? await engine.unwrapDataKey(key, context, stored.wrappedKey)
        : await engine.generateDataKey(key, context);
      // Recheck revocation/disable after the network operation, before delivery.
      const [currentApplication, currentKey] = await Promise.all([
        prisma.managedKeyApplication.findUnique({ where: { id: application.id }, include }),
        prisma.managedKey.findUnique({ where: { id: key.id } }),
      ]);
      authorizeApplication(currentApplication, workspaceSlug, context);
      authorizeKey(currentApplication, currentKey, context);
      return json({ provider: PROVIDER, version: VERSION, keyId: key.id, ...material });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const select = {
  id: true,
  name: true,
  environment: true,
  purpose: true,
  keyName: true,
  maxTenants: true,
  vercelTeamId: true,
  vercelProjectId: true,
  vercelEnvironment: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/** Workspace administrator actions, dispatched from the admin API. */
export async function applicationAdmin(
  req: Request,
  actor: { workspaceId: string; userId: string },
  action: ApplicationAction,
  audit: Audit,
  id?: string,
): Promise<Response> {
  const { workspaceId, userId } = actor;
  if (action === 'application.list') {
    const applications = await prisma.managedKeyApplication.findMany({
      where: { workspaceId },
      select,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return json({ applications });
  }
  if (action === 'application.revoke') {
    const application = await prisma.managedKeyApplication.findFirst({
      where: { id, workspaceId },
    });
    if (!application) throw new ManagedKeyError(404, 'Application not found.');
    await prisma.managedKeyApplication.update({
      where: { id: application.id },
      data: { revokedAt: application.revokedAt ?? new Date() },
    });
    return json({ id: application.id, revoked: true });
  }
  const input = applicationSchema.safeParse(await requestJson(req));
  if (!input.success) throw new ManagedKeyError(400, 'Invalid application request.');
  const { vercel, token, ...scope } = input.data;
  const existing = await prisma.managedKeyApplication.findUnique({
    where: { workspaceId_name: { workspaceId, name: scope.name } },
    select,
  });
  if (existing) {
    audit.applicationId = existing.id;
    // Registering the same deployment again is idempotent and may change only
    // the tenant limit. Static tokens are issued once, like credentials.
    const same =
      vercel &&
      !existing.revokedAt &&
      existing.environment === scope.environment &&
      existing.purpose === scope.purpose &&
      existing.keyName === scope.keyName &&
      existing.vercelTeamId === vercel.teamId &&
      existing.vercelProjectId === vercel.projectId &&
      existing.vercelEnvironment === vercel.environment;
    if (!same) throw new ManagedKeyError(409, 'An application with this name already exists.');
    if (existing.maxTenants === scope.maxTenants) return json({ application: existing });
    const application = await prisma.managedKeyApplication.update({
      where: { id: existing.id },
      data: { maxTenants: scope.maxTenants },
      select,
    });
    return json({ application });
  }
  const secret = token
    ? `${APPLICATION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    : undefined;
  const data = {
    ...scope,
    workspaceId,
    createdByUserId: userId,
    ...(vercel
      ? {
          vercelTeamId: vercel.teamId,
          vercelProjectId: vercel.projectId,
          vercelEnvironment: vercel.environment,
        }
      : {}),
    ...(secret && token
      ? {
          tokenHash: digest(secret),
          expiresAt: new Date(Date.now() + token.expiresInDays * 86400000),
        }
      : {}),
  };
  let application;
  try {
    application = await prisma.$transaction(async (tx) => {
      if (vercel) {
        // At most one active application per deployment and purpose, also for
        // concurrent registrations. Postgres releases the lock with the transaction.
        const identity = `managed-key-application:${workspaceId}:${scope.purpose}:${vercel.teamId}:${vercel.projectId}:${vercel.environment}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity}))`;
        const clash = await tx.managedKeyApplication.findFirst({
          where: {
            workspaceId,
            purpose: scope.purpose,
            vercelTeamId: vercel.teamId,
            vercelProjectId: vercel.projectId,
            vercelEnvironment: vercel.environment,
            revokedAt: null,
          },
          select: { id: true },
        });
        if (clash) {
          throw new ManagedKeyError(
            409,
            'This deployment already has an application for this purpose.',
          );
        }
      }
      return tx.managedKeyApplication.create({ data, select });
    });
  } catch (error) {
    // A concurrent registration took the name first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ManagedKeyError(409, 'An application with this name already exists.');
    }
    throw error;
  }
  audit.applicationId = application.id;
  return json({ application, ...(secret ? { token: secret } : {}) }, 201);
}
