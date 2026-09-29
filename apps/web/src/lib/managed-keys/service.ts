import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { prisma, type ManagedKey, type Prisma } from '@envstore/db';
import { authenticateBearer, resolveWorkspaceForAuth } from '@/lib/api-auth';
import { applicationAdmin, type ApplicationAction } from './applications';
import { audited, bearer, parseId, throttle, type Audit } from './common';
import {
  APPLICATION_TOKEN_PREFIX,
  CREDENTIAL_PREFIX,
  PROVIDER,
  VERSION,
  credentialSchema,
  generateSchema,
  provisionSchema,
  unwrapSchema,
  type BindingContext,
  type Operation,
} from './contracts';
import { ManagedKeyError, errorResponse, json, requestJson, requireService } from './http';
import * as engine from './openbao';

function tokenHash(req: Request): string | null {
  const token = bearer(req);
  if (!token || !/^esmk_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

const credentialInclude = {
  workspace: { select: { deletedAt: true } },
  grants: { include: { key: true } },
} as const;
type Credential = Prisma.ManagedKeyCredentialGetPayload<{ include: typeof credentialInclude }>;

function authorize(
  credential: Credential | null,
  id: string,
  operation: Operation,
  context: BindingContext,
): ManagedKey {
  if (
    !credential ||
    credential.revokedAt ||
    credential.expiresAt <= new Date() ||
    credential.workspace.deletedAt
  ) {
    throw new ManagedKeyError(401, 'Invalid application credential.');
  }
  const grant = credential.grants.find((g) => g.keyId === id);
  const key = grant?.key;
  if (
    !grant?.operations.includes(operation) ||
    !key ||
    key.workspaceId !== credential.workspaceId ||
    key.tenantId !== credential.tenantId ||
    key.environment !== credential.environment ||
    key.tenantId !== context.teamId ||
    key.purpose !== context.purpose
  ) {
    throw new ManagedKeyError(403, 'Key or context is not authorized.');
  }
  if (key.disabledAt || !key.provisionedAt) throw new ManagedKeyError(403, 'Key is unavailable.');
  return key;
}

export async function runtimeRequest(
  req: Request,
  rawId: string,
  operation: Operation,
): Promise<Response> {
  try {
    requireService(req);
    const id = parseId(rawId);
    const hash = tokenHash(req);
    const credential = hash
      ? await prisma.managedKeyCredential.findUnique({
          where: { tokenHash: hash },
          include: credentialInclude,
        })
      : null;
    throttle(credential?.id ?? 'anonymous');
    return await audited(
      {
        workspaceId: credential?.workspaceId,
        credentialId: credential?.id,
        keyId: id,
        operation: `data-key.${operation}`,
      },
      async () => {
        if (!credential) throw new ManagedKeyError(401, 'Invalid application credential.');
        const body = await requestJson(req);
        const result = (operation === 'generate' ? generateSchema : unwrapSchema).safeParse(body);
        if (!result.success) throw new ManagedKeyError(400, 'Invalid key request.');
        const key = authorize(credential, id, operation, result.data.context);
        const material =
          operation === 'generate'
            ? await engine.generateDataKey(key, result.data.context)
            : await engine.unwrapDataKey(
                key,
                result.data.context,
                unwrapSchema.parse(result.data).wrappedKey,
              );
        // Recheck revocation/disable after the network operation, before delivery.
        const current = await prisma.managedKeyCredential.findUnique({
          where: { tokenHash: hash! },
          include: credentialInclude,
        });
        authorize(current, id, operation, result.data.context);
        return json({ provider: PROVIDER, version: VERSION, keyId: id, ...material });
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

type Admin = { workspaceId: string; userId: string };
export type AdminAction =
  | 'key.list'
  | 'key.provision'
  | 'key.rotate'
  | 'key.disable'
  | 'credential.list'
  | 'credential.issue'
  | 'credential.revoke'
  | 'audit.list'
  | ApplicationAction;

async function admin(req: Request, workspaceSlug: string): Promise<Admin> {
  // Application credentials have no path into user authentication or ACLs.
  const token = bearer(req);
  if (token?.startsWith(CREDENTIAL_PREFIX) || token?.startsWith(APPLICATION_TOKEN_PREFIX)) {
    throw new ManagedKeyError(403, 'User administrator authentication is required.');
  }
  const auth = await authenticateBearer(req);
  if (!auth) throw new ManagedKeyError(401, 'Not authenticated.');
  if (auth.kind !== 'user')
    throw new ManagedKeyError(403, 'User administrator authentication is required.');
  const workspace = await resolveWorkspaceForAuth(auth, workspaceSlug);
  if (!workspace) throw new ManagedKeyError(404, 'Workspace not found.');
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: auth.user.id } },
  });
  if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
    await prisma.managedKeyAuditEvent.create({
      data: {
        workspaceId: workspace.id,
        userId: auth.user.id,
        operation: 'admin.authorize',
        outcome: 'denied',
      },
    });
    throw new ManagedKeyError(403, 'Workspace administrator role is required.');
  }
  return { workspaceId: workspace.id, userId: auth.user.id };
}

async function scopedKey(workspaceId: string, id: string): Promise<ManagedKey> {
  const key = await prisma.managedKey.findFirst({ where: { id, workspaceId } });
  if (!key) throw new ManagedKeyError(404, 'Key not found.');
  return key;
}

const credentialSelect = {
  id: true,
  applicationId: true,
  tenantId: true,
  environment: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  grants: { select: { keyId: true, operations: true } },
} as const;

async function performAdmin(
  req: Request,
  actor: Admin,
  action: AdminAction,
  audit: Audit,
  id?: string,
): Promise<Response> {
  const { workspaceId, userId } = actor;
  if (action.startsWith('application.')) {
    return applicationAdmin(req, actor, action as ApplicationAction, audit, id);
  }
  if (action === 'key.list') {
    const keys = await prisma.managedKey.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return json({ keys });
  }
  if (action === 'key.provision') {
    const input = provisionSchema.safeParse(await requestJson(req));
    if (!input.success) throw new ManagedKeyError(400, 'Invalid provisioning request.');
    const { name, tenantId, environment, purpose } = input.data;
    const key = await prisma.managedKey.upsert({
      where: {
        workspaceId_tenantId_environment_name: { workspaceId, tenantId, environment, name },
      },
      create: { workspaceId, ...input.data },
      update: {},
    });
    audit.keyId = key.id;
    if (key.purpose !== purpose)
      throw new ManagedKeyError(409, 'Existing key has a different purpose.');
    if (key.disabledAt) throw new ManagedKeyError(409, 'Key is disabled.');
    const keyVersion = key.provisionedAt
      ? await engine.inspectKey(key.id)
      : await engine.provisionKey(key.id);
    const ready = await prisma.managedKey.update({
      where: { id: key.id },
      data: { provisionedAt: key.provisionedAt ?? new Date() },
    });
    return json({ key: ready, keyVersion, provider: PROVIDER });
  }
  if (action === 'key.rotate' || action === 'key.disable') {
    const key = await scopedKey(workspaceId, id!);
    if (action === 'key.disable') {
      const disabled = await prisma.managedKey.update({
        where: { id: key.id },
        data: { disabledAt: key.disabledAt ?? new Date() },
      });
      return json({ key: disabled });
    }
    if (key.disabledAt || !key.provisionedAt) throw new ManagedKeyError(409, 'Key is unavailable.');
    const keyVersion = await engine.rotateKey(key.id);
    return json({ keyId: key.id, keyVersion });
  }
  if (action === 'credential.list') {
    return json({
      credentials: await prisma.managedKeyCredential.findMany({
        where: { workspaceId },
        select: credentialSelect,
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    });
  }
  if (action === 'credential.issue') {
    const input = credentialSchema.safeParse(await requestJson(req));
    if (!input.success) throw new ManagedKeyError(400, 'Invalid credential request.');
    const { grants, expiresInDays, ...scope } = input.data;
    const keys = await prisma.managedKey.findMany({
      where: {
        id: { in: grants.map((g) => g.keyId) },
        workspaceId,
        tenantId: scope.tenantId,
        environment: scope.environment,
        disabledAt: null,
        provisionedAt: { not: null },
      },
    });
    if (keys.length !== grants.length)
      throw new ManagedKeyError(
        400,
        'Every grant must reference an active key in this tenant and environment.',
      );
    const token = `${CREDENTIAL_PREFIX}${randomBytes(32).toString('base64url')}`;
    const credential = await prisma.managedKeyCredential.create({
      data: {
        ...scope,
        workspaceId,
        createdByUserId: userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + expiresInDays * 86400000),
        grants: { create: grants },
      },
      select: credentialSelect,
    });
    audit.targetCredentialId = credential.id;
    return json({ ...credential, token }, 201);
  }
  if (action === 'credential.revoke') {
    const credential = await prisma.managedKeyCredential.findFirst({ where: { id, workspaceId } });
    if (!credential) throw new ManagedKeyError(404, 'Credential not found.');
    await prisma.managedKeyCredential.update({
      where: { id },
      data: { revokedAt: credential.revokedAt ?? new Date() },
    });
    return json({ id, revoked: true });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new ManagedKeyError(400, 'Invalid audit limit.');
  const cursor = url.searchParams.get('cursor');
  if (
    cursor &&
    !(await prisma.managedKeyAuditEvent.findFirst({ where: { id: parseId(cursor), workspaceId } }))
  ) {
    throw new ManagedKeyError(400, 'Invalid audit cursor.');
  }
  const events = await prisma.managedKeyAuditEvent.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return json({
    events: events.slice(0, limit),
    nextCursor: events.length > limit ? events[limit - 1]!.id : null,
  });
}

export async function adminRequest(
  req: Request,
  workspaceSlug: string,
  action: AdminAction,
  rawId?: string,
): Promise<Response> {
  try {
    requireService(req);
    const targeted = ['key.rotate', 'key.disable', 'credential.revoke', 'application.revoke'];
    if (targeted.includes(action) && !rawId) {
      throw new ManagedKeyError(400, 'Invalid identifier.');
    }
    const id = rawId ? parseId(rawId) : undefined;
    const actor = await admin(req, workspaceSlug);
    throttle(actor.userId);
    const audit: Audit = {
      ...actor,
      keyId: action.startsWith('key.') ? id : undefined,
      targetCredentialId: action === 'credential.revoke' ? id : undefined,
      applicationId: action === 'application.revoke' ? id : undefined,
      operation: action,
    };
    return await audited(audit, () => performAdmin(req, actor, action, audit, id));
  } catch (error) {
    return errorResponse(error);
  }
}
