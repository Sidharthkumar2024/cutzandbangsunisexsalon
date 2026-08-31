ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "recurrenceEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "recurrenceRule" JSONB;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "recurrenceNextAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "recurrenceLastAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "recurrenceParentId" TEXT;
CREATE INDEX IF NOT EXISTS "Campaign_recurrenceEnabled_recurrenceNextAt_idx" ON "Campaign"("recurrenceEnabled", "recurrenceNextAt");
