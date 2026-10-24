-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "errorType" VARCHAR(200),
    "stackTrace" TEXT,
    "environment" VARCHAR(80) NOT NULL DEFAULT 'production',
    "release" VARCHAR(160),
    "fingerprint" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_apiKeyHash_key" ON "Project"("apiKeyHash");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_createdAt_idx" ON "ErrorEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_fingerprint_idx" ON "ErrorEvent"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_environment_occurredAt_idx" ON "ErrorEvent"("projectId", "environment", "occurredAt");

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
