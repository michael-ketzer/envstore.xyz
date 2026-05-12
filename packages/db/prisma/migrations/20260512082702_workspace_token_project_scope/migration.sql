-- Project-scope allowlist for workspace service tokens. Empty array (the
-- default + the value for every existing row) means "all projects in the
-- workspace" — preserves today's behavior. A populated array restricts the
-- token to those specific project IDs.

ALTER TABLE "WorkspaceToken"
  ADD COLUMN "scopedProjectIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
