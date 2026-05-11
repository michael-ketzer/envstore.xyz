import { prisma } from '@envstore/db';
import { LIMITS, recipientRegisterSchema, detectRecipientKind } from '@envstore/shared';
import { parseRecipient } from '@envstore/crypto/recipients';

import { apiError, authenticateBearer, requireUserAuth, unauthorized } from '@/lib/api-auth';
import { recordAudit } from '@/lib/audit';

export async function GET(req: Request) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;
  const recipients = await prisma.userRecipient.findMany({
    where: { userId: userAuth.user.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      recipient: true,
      kind: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  return Response.json(recipients);
}

export async function POST(req: Request) {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();
  const userAuth = requireUserAuth(auth);
  if (userAuth instanceof Response) return userAuth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Invalid JSON body.', 400);
  }
  const parsed = recipientRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Invalid input.', 400);
  }

  // Structural validation (server-side) so we don't store garbage.
  try {
    parseRecipient(parsed.data.recipient);
  } catch (err) {
    return apiError((err as Error).message, 400);
  }
  const detectedKind = detectRecipientKind(parsed.data.recipient);
  if (detectedKind && detectedKind !== parsed.data.kind) {
    return apiError(
      `Recipient looks like ${detectedKind} but you submitted ${parsed.data.kind}.`,
      400,
    );
  }

  const existingCount = await prisma.userRecipient.count({ where: { userId: userAuth.user.id } });
  if (existingCount >= LIMITS.maxRecipientsPerUser) {
    return apiError(
      `You already have ${existingCount} recipients (cap: ${LIMITS.maxRecipientsPerUser}). Revoke one before adding another.`,
      409,
    );
  }

  const existing = await prisma.userRecipient.findUnique({
    where: { userId_recipient: { userId: userAuth.user.id, recipient: parsed.data.recipient } },
  });
  if (existing) {
    // Treat as success — update label if changed.
    if (existing.label !== parsed.data.label) {
      await prisma.userRecipient.update({
        where: { id: existing.id },
        data: { label: parsed.data.label },
      });
    }
    return Response.json({
      id: existing.id,
      recipient: existing.recipient,
      kind: existing.kind,
      label: parsed.data.label,
    });
  }

  const created = await prisma.userRecipient.create({
    data: {
      userId: userAuth.user.id,
      recipient: parsed.data.recipient,
      kind: parsed.data.kind,
      label: parsed.data.label,
    },
  });
  await recordAudit({
    userId: userAuth.user.id,
    action: 'recipient.register',
    resourceType: 'recipient',
    resourceId: created.id,
    metadata: { kind: created.kind, label: created.label },
  });
  return Response.json(
    { id: created.id, recipient: created.recipient, kind: created.kind, label: created.label },
    { status: 201 },
  );
}
