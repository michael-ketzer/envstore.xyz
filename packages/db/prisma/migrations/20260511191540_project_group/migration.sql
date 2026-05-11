-- Add optional folder for grouping related projects in the dashboard
-- (typical case: all apps of a single monorepo). Pure UX — no FK to a
-- "ProjectGroup" table, the value is just a free-form folder name shared
-- across siblings.
ALTER TABLE "Project" ADD COLUMN "group" TEXT;

-- Speeds up the "group by group" rendering in the workspace home page.
CREATE INDEX "Project_workspaceId_group_idx" ON "Project"("workspaceId", "group");
