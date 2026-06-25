-- =============================================================================
-- SQUASHED BASELINE — MANUAL BOOTSTRAP TOOL
-- Source of truth: prisma/schema.prisma (as of 2026-06-25)
--
-- PURPOSE
--   Bootstrap a brand-new empty PostgreSQL database to the full current schema.
--
-- IMPORTANT — this file is NOT in prisma/migrations/ and is NOT applied
--   automatically by `prisma migrate deploy`. Running `prisma migrate deploy`
--   on a fresh DB will NOT work unless this file has been run first AND all
--   migrations have been baselined with `prisma migrate resolve --applied`.
--   See RUNBOOK.md Runbook A for the complete procedure.
--
-- SAFETY
--   All statements use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   and DO $$ ... END $$ guards on FK constraints, so this file is re-entrant:
--   running it twice on the same DB is a no-op.
--
-- TABLES (in dependency order)
--   User, Workspace, WorkspaceUser, Order, Customer,
--   SystemSettings, Quote, QuoteItem,
--   EstimateSnapshot, EstimateAdjustment,
--   TeamCalibrationProfile, CalibrationAuditLog,
--   CreditCompensation
-- =============================================================================

-- pgcrypto is required for gen_random_uuid() used as the Quote.shareToken default
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. User
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "User" (
  "id"                   TEXT        NOT NULL,
  "email"                TEXT        NOT NULL,
  "passwordHash"         TEXT,
  "otpCode"              TEXT,
  "otpExpiresAt"         TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "phoneNumber"          TEXT,
  "termsAcceptedAt"      TIMESTAMP(3),
  "termsVersionAccepted" TEXT,
  "bookingUrl"           TEXT,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key"       ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneNumber_key" ON "User"("phoneNumber");

-- ---------------------------------------------------------------------------
-- 2. Workspace
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Workspace" (
  "id"               TEXT        NOT NULL,
  "name"             TEXT        NOT NULL,
  "subscriptionPlan" TEXT        NOT NULL DEFAULT 'FREE',
  "creditBalance"    INTEGER     NOT NULL DEFAULT 20,
  "ecpayToken"       TEXT,
  "nextBillingDate"  TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. WorkspaceUser  (FK: User, Workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WorkspaceUser" (
  "userId"      TEXT        NOT NULL,
  "workspaceId" TEXT        NOT NULL,
  "role"        TEXT        NOT NULL DEFAULT 'MEMBER',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceUser_pkey" PRIMARY KEY ("userId", "workspaceId")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceUser_userId_fkey') THEN
    ALTER TABLE "WorkspaceUser"
      ADD CONSTRAINT "WorkspaceUser_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceUser_workspaceId_fkey') THEN
    ALTER TABLE "WorkspaceUser"
      ADD CONSTRAINT "WorkspaceUser_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Order  (FK: Workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Order" (
  "id"            TEXT        NOT NULL,
  "orderNo"       TEXT        NOT NULL,
  "workspaceId"   TEXT        NOT NULL,
  "amount"        INTEGER     NOT NULL,
  "creditsAdded"  INTEGER     NOT NULL,
  "status"        TEXT        NOT NULL DEFAULT 'PENDING',
  "paymentMethod" TEXT,
  "tradeNo"       TEXT,
  "paymentDate"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderNo_key" ON "Order"("orderNo");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_workspaceId_fkey') THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Customer  (FK: Workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Customer" (
  "id"          TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "industry"    TEXT,
  "description" TEXT,
  "aiSummary"   TEXT,
  "email"       TEXT,
  "phone"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "taxId"       TEXT,
  "type"        TEXT        NOT NULL DEFAULT 'company',
  "workspaceId" TEXT        NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_workspaceId_fkey') THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. SystemSettings  (FK: Workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SystemSettings" (
  "id"                           TEXT             NOT NULL,
  "companyName"                  TEXT,
  "taxId"                        TEXT,
  "contactEmail"                 TEXT,
  "juniorRate"                   DOUBLE PRECISION,
  "seniorRate"                   DOUBLE PRECISION,
  "pmRate"                       DOUBLE PRECISION,
  "designRate"                   DOUBLE PRECISION,
  "targetMarginMin"              DOUBLE PRECISION,
  "targetMarginMax"              DOUBLE PRECISION,
  "updatedAt"                    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "companyRepresentativeSealUrl" TEXT,
  "companySealUrl"               TEXT,
  "roleRates"                    JSONB,
  "projectTypes"                 JSONB,
  "materials"                    JSONB,
  "quoteValidityDays"            INTEGER          DEFAULT 30,
  "estimationBaselines"          JSONB,
  "workspaceId"                  TEXT             NOT NULL,
  CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SystemSettings_workspaceId_key" ON "SystemSettings"("workspaceId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SystemSettings_workspaceId_fkey') THEN
    ALTER TABLE "SystemSettings"
      ADD CONSTRAINT "SystemSettings_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Quote  (FK: Customer nullable, Workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Quote" (
  "id"                    TEXT             NOT NULL,
  "createdAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customerName"          TEXT             NOT NULL,
  "description"           TEXT,
  "expectedDays"          INTEGER,
  "projectName"           TEXT             NOT NULL,
  "projectType"           TEXT             NOT NULL,
  "generationType"        TEXT             NOT NULL DEFAULT 'quote',
  "status"                TEXT             NOT NULL DEFAULT 'DRAFT',
  "totalAmount"           DOUBLE PRECISION,
  "updatedAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customerId"            TEXT,
  "totalCost"             DOUBLE PRECISION,
  "totalMargin"           DOUBLE PRECISION,
  "paymentTerms"          TEXT,
  "validityDays"          INTEGER          DEFAULT 30,
  "wonAmount"             DOUBLE PRECISION,
  "workspaceId"           TEXT             NOT NULL,
  "materials"             JSONB,
  "roleRates"             JSONB,
  "shareToken"            TEXT             DEFAULT gen_random_uuid()::text,
  "shareViewedAt"         TIMESTAMP(3),
  "lastViewedAt"          TIMESTAMP(3),
  "viewCount"             INTEGER          NOT NULL DEFAULT 0,
  "proposalStatus"        TEXT             NOT NULL DEFAULT 'draft',
  "acceptedAt"            TIMESTAMP(3),
  "clientResponseName"    TEXT,
  "clientResponseEmail"   TEXT,
  "clientResponseMessage" TEXT,
  "proposalContent"       JSONB,
  "proposalTheme"         JSONB,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Quote_shareToken_key" ON "Quote"("shareToken");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quote_customerId_fkey') THEN
    ALTER TABLE "Quote"
      ADD CONSTRAINT "Quote_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quote_workspaceId_fkey') THEN
    ALTER TABLE "Quote"
      ADD CONSTRAINT "Quote_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. QuoteItem  (FK: Quote CASCADE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "QuoteItem" (
  "id"                    TEXT             NOT NULL,
  "quoteId"               TEXT             NOT NULL,
  "description"           TEXT             NOT NULL,
  "estimatedHours"        DOUBLE PRECISION,
  "suggestedRole"         TEXT,
  "hourlyRate"            DOUBLE PRECISION NOT NULL,
  "aiSuggestedHourlyRate" DOUBLE PRECISION,
  "configuredHourlyRate"  DOUBLE PRECISION,
  "rateSource"            TEXT,
  "amount"                DOUBLE PRECISION NOT NULL,
  "createdAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type"                  TEXT             NOT NULL DEFAULT 'service',
  "unit"                  TEXT,
  CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteItem_quoteId_fkey') THEN
    ALTER TABLE "QuoteItem"
      ADD CONSTRAINT "QuoteItem_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. EstimateSnapshot  (FK: Workspace, Quote nullable; self-FK: parentSnapshotId)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EstimateSnapshot" (
  "id"                        TEXT             NOT NULL,
  "workspaceId"               TEXT             NOT NULL,
  "quoteId"                   TEXT,
  "parentSnapshotId"          TEXT,
  "revisionNumber"            INTEGER          NOT NULL DEFAULT 1,
  "baselineVersion"           TEXT             NOT NULL DEFAULT '1',
  "detectedModules"           JSONB            NOT NULL,
  "baselineHours"             JSONB            NOT NULL,
  "complexityMultiplier"      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "riskBuffer"                DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rawGlobalEstimate"         JSONB            NOT NULL,
  "calibratedEstimate"        JSONB,
  "calibrationFactorsApplied" JSONB,
  "originalHoursRange"        JSONB            NOT NULL,
  "confidenceScore"           DOUBLE PRECISION,
  "missingInfo"               JSONB,
  "projectRiskFlags"          JSONB,
  "requirementSpec"           JSONB,
  "createdAt"                 TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstimateSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EstimateSnapshot_parentSnapshotId_key"
  ON "EstimateSnapshot"("parentSnapshotId");
CREATE INDEX IF NOT EXISTS "EstimateSnapshot_workspaceId_idx"
  ON "EstimateSnapshot"("workspaceId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstimateSnapshot_workspaceId_fkey') THEN
    ALTER TABLE "EstimateSnapshot"
      ADD CONSTRAINT "EstimateSnapshot_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstimateSnapshot_quoteId_fkey') THEN
    ALTER TABLE "EstimateSnapshot"
      ADD CONSTRAINT "EstimateSnapshot_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstimateSnapshot_parentSnapshotId_fkey') THEN
    ALTER TABLE "EstimateSnapshot"
      ADD CONSTRAINT "EstimateSnapshot_parentSnapshotId_fkey"
      FOREIGN KEY ("parentSnapshotId") REFERENCES "EstimateSnapshot"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. EstimateAdjustment  (FK: EstimateSnapshot CASCADE, Workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EstimateAdjustment" (
  "id"                    TEXT             NOT NULL,
  "snapshotId"            TEXT             NOT NULL,
  "workspaceId"           TEXT             NOT NULL,
  "adjustedModules"       JSONB,
  "adjustedHoursByRole"   JSONB,
  "actualHoursByRole"     JSONB,
  "adjustedEstimateRange" JSONB,
  "adjustmentReason"      TEXT,
  "finalQuotedPrice"      DOUBLE PRECISION,
  "acceptedPrice"         DOUBLE PRECISION,
  "projectStatus"         TEXT             NOT NULL DEFAULT 'draft',
  "scopeChanged"          BOOLEAN          NOT NULL DEFAULT false,
  "createdAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstimateAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EstimateAdjustment_snapshotId_key"
  ON "EstimateAdjustment"("snapshotId");
CREATE INDEX IF NOT EXISTS "EstimateAdjustment_workspaceId_idx"
  ON "EstimateAdjustment"("workspaceId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstimateAdjustment_snapshotId_fkey') THEN
    ALTER TABLE "EstimateAdjustment"
      ADD CONSTRAINT "EstimateAdjustment_snapshotId_fkey"
      FOREIGN KEY ("snapshotId") REFERENCES "EstimateSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EstimateAdjustment_workspaceId_fkey') THEN
    ALTER TABLE "EstimateAdjustment"
      ADD CONSTRAINT "EstimateAdjustment_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 11. TeamCalibrationProfile  (FK: Workspace; unique 1-per-workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "TeamCalibrationProfile" (
  "id"                            TEXT        NOT NULL,
  "workspaceId"                   TEXT        NOT NULL,
  "estimateCalibrationFactors"    JSONB,
  "pricingCalibrationFactors"     JSONB,
  "projectTypeCalibrationFactors" JSONB,
  "estimateSampleSize"            INTEGER     NOT NULL DEFAULT 0,
  "pricingSampleSize"             INTEGER     NOT NULL DEFAULT 0,
  "estimateConfidenceLevel"       TEXT        NOT NULL DEFAULT 'low',
  "pricingConfidenceLevel"        TEXT        NOT NULL DEFAULT 'low',
  "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamCalibrationProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TeamCalibrationProfile_workspaceId_key"
  ON "TeamCalibrationProfile"("workspaceId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamCalibrationProfile_workspaceId_fkey') THEN
    ALTER TABLE "TeamCalibrationProfile"
      ADD CONSTRAINT "TeamCalibrationProfile_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 12. CalibrationAuditLog  (FK: Workspace, TeamCalibrationProfile)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CalibrationAuditLog" (
  "id"                      TEXT        NOT NULL,
  "workspaceId"             TEXT        NOT NULL,
  "profileId"               TEXT        NOT NULL,
  "appliedBy"               TEXT        NOT NULL,
  "previousEstimateFactors" JSONB,
  "newEstimateFactors"      JSONB,
  "previousPricingFactors"  JSONB,
  "newPricingFactors"       JSONB,
  "reason"                  TEXT,
  "appliedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalibrationAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CalibrationAuditLog_workspaceId_idx"
  ON "CalibrationAuditLog"("workspaceId");
CREATE INDEX IF NOT EXISTS "CalibrationAuditLog_profileId_idx"
  ON "CalibrationAuditLog"("profileId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalibrationAuditLog_workspaceId_fkey') THEN
    ALTER TABLE "CalibrationAuditLog"
      ADD CONSTRAINT "CalibrationAuditLog_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalibrationAuditLog_profileId_fkey') THEN
    ALTER TABLE "CalibrationAuditLog"
      ADD CONSTRAINT "CalibrationAuditLog_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "TeamCalibrationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. CreditCompensation  (FK: Workspace)
--     Records failed credit refunds for manual or automated retry.
--     Operations: "refine_refund"
--     Status: "pending" → "resolved"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CreditCompensation" (
  "id"          TEXT        NOT NULL,
  "workspaceId" TEXT        NOT NULL,
  "amount"      INTEGER     NOT NULL,
  "operation"   TEXT        NOT NULL,
  "status"      TEXT        NOT NULL DEFAULT 'pending',
  "error"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"  TIMESTAMP(3),
  CONSTRAINT "CreditCompensation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CreditCompensation_workspaceId_status_idx"
  ON "CreditCompensation"("workspaceId", "status");
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CreditCompensation_workspaceId_fkey'
  ) THEN
    ALTER TABLE "CreditCompensation"
      ADD CONSTRAINT "CreditCompensation_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
