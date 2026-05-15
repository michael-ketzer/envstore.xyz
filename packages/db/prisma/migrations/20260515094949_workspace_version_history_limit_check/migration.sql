-- Adds the 5..500 CHECK constraint that mirrors workspaceUpdateSchema.
-- DROP IF EXISTS first so this is safe on databases where the constraint was
-- applied out-of-band (the dev DB had it added manually before this migration
-- existed). On prod, the DROP is a no-op and the ADD lands cleanly.
ALTER TABLE "Workspace" DROP CONSTRAINT IF EXISTS "Workspace_versionHistoryLimit_check";
ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_versionHistoryLimit_check"
  CHECK ("versionHistoryLimit" BETWEEN 5 AND 500);
