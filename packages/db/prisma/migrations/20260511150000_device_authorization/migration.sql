-- CreateEnum
CREATE TYPE "DeviceAuthorizationStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CONSUMED');

-- CreateTable
CREATE TABLE "DeviceAuthorization" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "clientName" TEXT,
    "ipAddress" TEXT,
    "status" "DeviceAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 5,
    "lastPolledAt" TIMESTAMP(3),
    "pollAttempts" INTEGER NOT NULL DEFAULT 0,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cliTokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthorization_deviceCodeHash_key" ON "DeviceAuthorization"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthorization_userCode_key" ON "DeviceAuthorization"("userCode");

-- CreateIndex
CREATE INDEX "DeviceAuthorization_expiresAt_idx" ON "DeviceAuthorization"("expiresAt");

-- CreateIndex
CREATE INDEX "DeviceAuthorization_status_expiresAt_idx" ON "DeviceAuthorization"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceAuthorization" ADD CONSTRAINT "DeviceAuthorization_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
