-- Workspace-scoped service tokens for CI/CD. Bearer is sha256-hashed at rest
-- and shown once at creation; the `recipient` is the public half of an age
-- keypair generated on the minting machine (server never sees the private
-- key, preserving zero-knowledge for the CI runner's identity).

CREATE TABLE "WorkspaceToken" (
  "id"              TEXT          NOT NULL,
  "workspaceId"     TEXT          NOT NULL,
  "name"            TEXT          NOT NULL,
  "tokenHash"       TEXT          NOT NULL,
  "recipient"       TEXT          NOT NULL,
  "recipientKind"   "RecipientKind" NOT NULL DEFAULT 'AGE_X25519',
  "scopes"          TEXT[]        NOT NULL DEFAULT ARRAY['read', 'write']::TEXT[],
  "expiresAt"       TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "lastUsedAt"      TIMESTAMP(3),
  "createdByUserId" TEXT          NOT NULL,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceToken_tokenHash_key" ON "WorkspaceToken"("tokenHash");
CREATE INDEX "WorkspaceToken_workspaceId_revokedAt_idx" ON "WorkspaceToken"("workspaceId", "revokedAt");
CREATE INDEX "WorkspaceToken_createdByUserId_idx" ON "WorkspaceToken"("createdByUserId");

ALTER TABLE "WorkspaceToken" ADD CONSTRAINT "WorkspaceToken_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceToken" ADD CONSTRAINT "WorkspaceToken_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit attribution: when a request was authenticated by a service token,
-- record which one instead of (or in addition to) the user id.
ALTER TABLE "AuditLog" ADD COLUMN "workspaceTokenId" TEXT;
CREATE INDEX "AuditLog_workspaceTokenId_createdAt_idx" ON "AuditLog"("workspaceTokenId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceTokenId_fkey"
  FOREIGN KEY ("workspaceTokenId") REFERENCES "WorkspaceToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
