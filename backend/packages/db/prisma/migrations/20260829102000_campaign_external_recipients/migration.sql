-- Let a campaign snapshot include external uploaded/pasted recipients without
-- creating CRM customer records. Existing customer-backed campaign recipients
-- continue to work unchanged.
ALTER TABLE "CampaignRecipient"
  ALTER COLUMN "customerId" DROP NOT NULL,
  ADD COLUMN "externalName" TEXT,
  ADD COLUMN "externalPhone" TEXT,
  ADD COLUMN "externalEmail" TEXT;

CREATE INDEX "CampaignRecipient_campaignId_externalPhone_idx"
  ON "CampaignRecipient"("campaignId", "externalPhone");

ALTER TABLE "CampaignRecipient"
  ADD CONSTRAINT "CampaignRecipient_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
