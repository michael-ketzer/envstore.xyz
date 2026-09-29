-- Multi-tenant managed-key applications. Metadata only: static tokens are
-- stored SHA-256-hashed, and Vercel OIDC applications store no secret at all.
CREATE TABLE "ManagedKeyApplication" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "maxTenants" INTEGER NOT NULL,
    "vercelTeamId" TEXT,
    "vercelProjectId" TEXT,
    "vercelEnvironment" TEXT,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedKeyApplication_pkey" PRIMARY KEY ("id"),
    -- Exactly one authentication method: a Vercel deployment or a static token.
    CONSTRAINT "ManagedKeyApplication_authentication_check" CHECK (
      (
        "vercelTeamId" IS NOT NULL AND "vercelProjectId" IS NOT NULL AND
        "vercelEnvironment" IS NOT NULL AND "tokenHash" IS NULL AND "expiresAt" IS NULL
      ) OR (
        "vercelTeamId" IS NULL AND "vercelProjectId" IS NULL AND
        "vercelEnvironment" IS NULL AND "tokenHash" IS NOT NULL AND "expiresAt" IS NOT NULL
      )
    ),
    CONSTRAINT "ManagedKeyApplication_maxTenants_check" CHECK ("maxTenants" BETWEEN 1 AND 100000)
);

ALTER TABLE "ManagedKeyAuditEvent" ADD COLUMN "applicationId" TEXT;

CREATE UNIQUE INDEX "ManagedKeyApplication_tokenHash_key" ON "ManagedKeyApplication"("tokenHash");
CREATE UNIQUE INDEX "ManagedKeyApplication_workspaceId_name_key" ON "ManagedKeyApplication"("workspaceId", "name");
CREATE INDEX "ManagedKeyApplication_vercel_identity_idx" ON "ManagedKeyApplication"("workspaceId", "vercelProjectId", "vercelEnvironment");

ALTER TABLE "ManagedKeyApplication" ADD CONSTRAINT "ManagedKeyApplication_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
