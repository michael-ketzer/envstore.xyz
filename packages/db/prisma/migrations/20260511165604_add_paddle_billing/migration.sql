-- Add Paddle Customer ID to User. One Paddle Customer per user, reused across
-- every workspace they subscribe to.
ALTER TABLE "User" ADD COLUMN "paddleCustomerId" TEXT;
CREATE UNIQUE INDEX "User_paddleCustomerId_key" ON "User"("paddleCustomerId");

-- PaddleWebhookEvent — idempotency log for webhook delivery. Paddle retries
-- failed deliveries; we look up by eventId before processing so retries don't
-- double-apply state changes.
CREATE TABLE "PaddleWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaddleWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaddleWebhookEvent_eventId_key" ON "PaddleWebhookEvent"("eventId");
CREATE INDEX "PaddleWebhookEvent_eventType_processedAt_idx" ON "PaddleWebhookEvent"("eventType", "processedAt");
