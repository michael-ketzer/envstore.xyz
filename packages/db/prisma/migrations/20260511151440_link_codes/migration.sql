/*
  Warnings:

  - A unique constraint covering the columns `[linkCode]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "linkCode" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_linkCode_key" ON "Project"("linkCode");
