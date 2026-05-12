-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "versionHistoryLimit" INTEGER NOT NULL DEFAULT 50;

-- The shared schema (workspaceUpdateSchema) constrains this to 5..500. We
-- enforce the same bounds at the database layer so any write path that
-- somehow skips Zod validation (raw SQL fix-up, future Prisma client
-- replacement, an accidental @default change) can't land an out-of-range
-- value.
ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_versionHistoryLimit_check"
  CHECK ("versionHistoryLimit" BETWEEN 5 AND 500);
