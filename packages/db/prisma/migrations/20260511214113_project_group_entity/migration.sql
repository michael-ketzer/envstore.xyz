-- Promote the free-form Project.group string into a first-class ProjectGroup
-- entity with its own slug, name, and detail page. Each distinct
-- (workspaceId, group) pair becomes one ProjectGroup row; Project gains a
-- nullable groupId FK pointing at it.

CREATE TABLE "ProjectGroup" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "deletedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectGroup_workspaceId_slug_key" ON "ProjectGroup"("workspaceId", "slug");
CREATE INDEX "ProjectGroup_workspaceId_deletedAt_idx" ON "ProjectGroup"("workspaceId", "deletedAt");

ALTER TABLE "ProjectGroup" ADD CONSTRAINT "ProjectGroup_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add the FK column and matching index, then drop the old string column.
ALTER TABLE "Project" ADD COLUMN "groupId" TEXT;

ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Project_workspaceId_groupId_idx" ON "Project"("workspaceId", "groupId");

-- Backfill: create one ProjectGroup per distinct (workspaceId, group) and
-- link existing projects to it. cuid()-style ids aren't available in SQL, so
-- we use a deterministic-ish text id derived from workspaceId + group. The
-- application never reads these ids directly — lookups are by (workspaceId, slug).
INSERT INTO "ProjectGroup" ("id", "workspaceId", "slug", "name", "createdAt", "updatedAt")
SELECT
  'pgrp_' || md5("workspaceId" || ':' || "group") AS "id",
  "workspaceId",
  "group" AS "slug",
  "group" AS "name",
  MIN("createdAt") AS "createdAt",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "Project"
WHERE "group" IS NOT NULL
GROUP BY "workspaceId", "group";

UPDATE "Project" p
SET "groupId" = g."id"
FROM "ProjectGroup" g
WHERE g."workspaceId" = p."workspaceId"
  AND g."slug" = p."group"
  AND p."group" IS NOT NULL;

DROP INDEX IF EXISTS "Project_workspaceId_group_idx";
ALTER TABLE "Project" DROP COLUMN "group";
