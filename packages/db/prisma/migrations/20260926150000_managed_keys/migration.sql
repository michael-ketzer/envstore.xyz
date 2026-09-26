-- Wrapping-key material remains in OpenBao. These tables contain metadata only.
CREATE TABLE "ManagedKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provisionedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedKeyCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedKeyCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedKeyGrant" (
    "credentialId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "operations" TEXT[] NOT NULL,
    CONSTRAINT "ManagedKeyGrant_pkey" PRIMARY KEY ("credentialId", "keyId"),
    CONSTRAINT "ManagedKeyGrant_operations_check" CHECK (
      cardinality("operations") > 0 AND "operations" <@ ARRAY['generate', 'unwrap']::TEXT[]
    )
);

CREATE TABLE "ManagedKeyAuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "credentialId" TEXT,
    "targetCredentialId" TEXT,
    "keyId" TEXT,
    "operation" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedKeyAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagedKey_workspaceId_tenantId_environment_name_key" ON "ManagedKey"("workspaceId", "tenantId", "environment", "name");
CREATE UNIQUE INDEX "ManagedKeyCredential_tokenHash_key" ON "ManagedKeyCredential"("tokenHash");
CREATE INDEX "ManagedKeyCredential_workspaceId_createdAt_idx" ON "ManagedKeyCredential"("workspaceId", "createdAt");
CREATE INDEX "ManagedKeyGrant_keyId_idx" ON "ManagedKeyGrant"("keyId");
CREATE INDEX "ManagedKeyAuditEvent_workspaceId_createdAt_id_idx" ON "ManagedKeyAuditEvent"("workspaceId", "createdAt", "id");

ALTER TABLE "ManagedKey" ADD CONSTRAINT "ManagedKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedKeyCredential" ADD CONSTRAINT "ManagedKeyCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedKeyGrant" ADD CONSTRAINT "ManagedKeyGrant_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ManagedKeyCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedKeyGrant" ADD CONSTRAINT "ManagedKeyGrant_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ManagedKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedKeyAuditEvent" ADD CONSTRAINT "ManagedKeyAuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
