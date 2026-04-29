CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "Quote"
  ADD COLUMN "shareToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "shareViewedAt" TIMESTAMP(3),
  ADD COLUMN "lastViewedAt" TIMESTAMP(3),
  ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "proposalStatus" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "clientResponseName" TEXT,
  ADD COLUMN "clientResponseEmail" TEXT,
  ADD COLUMN "clientResponseMessage" TEXT;

CREATE UNIQUE INDEX "Quote_shareToken_key" ON "Quote"("shareToken");

ALTER TABLE "User"
  ADD COLUMN "bookingUrl" TEXT;
