-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('UNRESOLVED', 'RESOLVED', 'IGNORED');

-- AlterTable
ALTER TABLE "ErrorEvent" ADD COLUMN     "issueId" TEXT;

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "title" VARCHAR(2000) NOT NULL,
    "errorType" VARCHAR(200) NOT NULL,
    "environment" VARCHAR(80) NOT NULL DEFAULT 'production',
    "release" VARCHAR(160),
    "stackTrace" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_projectId_status_lastSeenAt_idx" ON "Issue"("projectId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Issue_projectId_environment_lastSeenAt_idx" ON "Issue"("projectId", "environment", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Issue_projectId_lastSeenAt_idx" ON "Issue"("projectId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_projectId_fingerprint_key" ON "Issue"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_issueId_occurredAt_idx" ON "ErrorEvent"("issueId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: group existing events into issues by (projectId, fingerprint),
-- using the fields of the most recent event per group.
INSERT INTO "Issue" ("id", "projectId", "fingerprint", "title", "errorType", "environment", "release", "stackTrace", "status", "count", "firstSeenAt", "lastSeenAt", "createdAt", "updatedAt")
SELECT
  'issue_' || md5(random()::text || clock_timestamp()::text || e."projectId"),
  e."projectId",
  e."fingerprint",
  (array_agg(e."message" ORDER BY e."occurredAt" DESC))[1],
  coalesce((array_agg(e."errorType" ORDER BY e."occurredAt" DESC))[1], 'Error'),
  (array_agg(e."environment" ORDER BY e."occurredAt" DESC))[1],
  (array_agg(e."release" ORDER BY e."occurredAt" DESC))[1],
  (array_agg(e."stackTrace" ORDER BY e."occurredAt" DESC))[1],
  'UNRESOLVED',
  count(*)::int,
  min(e."occurredAt"),
  max(e."occurredAt"),
  now(),
  now()
FROM "ErrorEvent" e
GROUP BY e."projectId", e."fingerprint";

-- Link each historical event to its issue.
UPDATE "ErrorEvent" ev
SET "issueId" = i."id"
FROM "Issue" i
WHERE i."projectId" = ev."projectId" AND i."fingerprint" = ev."fingerprint";
