-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Index for the recovery sweep: eligible = PENDING with stale/null claim.
CREATE INDEX "WebhookDelivery_status_startedAt_idx" ON "WebhookDelivery"("status", "startedAt");
