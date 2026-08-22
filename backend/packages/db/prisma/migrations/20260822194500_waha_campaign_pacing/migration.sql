ALTER TABLE "Campaign"
ADD COLUMN "intervalSeconds" INTEGER,
ADD COLUMN "dailyCap" INTEGER,
ADD COLUMN "riskLevel" TEXT;

ALTER TABLE "CampaignRecipient"
ADD COLUMN "scheduledFor" TIMESTAMP(3),
ADD COLUMN "error" TEXT;

CREATE INDEX "CampaignRecipient_scheduledFor_status_idx"
ON "CampaignRecipient"("scheduledFor", "status");
