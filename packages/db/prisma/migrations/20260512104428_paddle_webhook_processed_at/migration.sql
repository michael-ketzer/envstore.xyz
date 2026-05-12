-- Split PaddleWebhookEvent's single timestamp into two:
--   receivedAt  — set on insert (signature verified, dedupe row created)
--   processedAt — set only AFTER dispatch succeeds; nullable
--
-- Why: previously the row was inserted before dispatch with
-- processedAt @default(now()). A failed dispatch left the row in place;
-- the next Paddle retry hit the unique-eventId constraint and the handler
-- returned `deduplicated: true` without re-dispatching, permanently
-- skipping the event. The split lets the handler distinguish "we saw this
-- and finished" from "we saw this and never finished" so retries can do
-- the right thing.

-- Add receivedAt as nullable so we can backfill from the existing
-- processedAt value (which was effectively "insert time").
ALTER TABLE "PaddleWebhookEvent"
  ADD COLUMN "receivedAt" TIMESTAMP(3);

UPDATE "PaddleWebhookEvent" SET "receivedAt" = "processedAt";

ALTER TABLE "PaddleWebhookEvent"
  ALTER COLUMN "receivedAt" SET NOT NULL,
  ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Relax processedAt: existing rows keep their value (the pre-split
-- invariant was "row exists → done", so treating those as processed is
-- the safe default). New rows insert null and are stamped after dispatch.
ALTER TABLE "PaddleWebhookEvent"
  ALTER COLUMN "processedAt" DROP DEFAULT,
  ALTER COLUMN "processedAt" DROP NOT NULL;

-- Swap the supporting index over to receivedAt — it's the natural sort
-- axis for "events of this type, most recent first" (and the only
-- always-set timestamp now).
DROP INDEX IF EXISTS "PaddleWebhookEvent_eventType_processedAt_idx";
CREATE INDEX "PaddleWebhookEvent_eventType_receivedAt_idx"
  ON "PaddleWebhookEvent" ("eventType", "receivedAt");
