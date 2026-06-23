-- Calibration Layer v2: split estimate vs pricing calibration + audit log

-- AlterTable: EstimateSnapshot — add immutable raw vs calibrated split
ALTER TABLE "EstimateSnapshot"
  ADD COLUMN IF NOT EXISTS "rawGlobalEstimate"         JSONB,
  ADD COLUMN IF NOT EXISTS "calibratedEstimate"        JSONB,
  ADD COLUMN IF NOT EXISTS "calibrationFactorsApplied" JSONB;

-- Backfill rawGlobalEstimate from originalEstimateRange for existing rows
UPDATE "EstimateSnapshot"
  SET "rawGlobalEstimate" = "originalEstimateRange"
  WHERE "rawGlobalEstimate" IS NULL;

-- AlterTable: EstimateAdjustment — add actualHoursByRole for completed projects
ALTER TABLE "EstimateAdjustment"
  ADD COLUMN IF NOT EXISTS "actualHoursByRole" JSONB;

-- AlterTable: TeamCalibrationProfile — split into estimate vs pricing factors
ALTER TABLE "TeamCalibrationProfile"
  ADD COLUMN IF NOT EXISTS "estimateCalibrationFactors"    JSONB,
  ADD COLUMN IF NOT EXISTS "pricingCalibrationFactors"     JSONB,
  ADD COLUMN IF NOT EXISTS "estimateSampleSize"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pricingSampleSize"             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "estimateConfidenceLevel"       TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS "pricingConfidenceLevel"        TEXT NOT NULL DEFAULT 'low';

-- Migrate existing moduleCalibrationFactors → estimateCalibrationFactors (best-effort)
UPDATE "TeamCalibrationProfile"
  SET "estimateCalibrationFactors" = "moduleCalibrationFactors"
  WHERE "moduleCalibrationFactors" IS NOT NULL
    AND "estimateCalibrationFactors" IS NULL;

-- DropColumn: old merged field (after migration)
ALTER TABLE "TeamCalibrationProfile"
  DROP COLUMN IF EXISTS "moduleCalibrationFactors",
  DROP COLUMN IF EXISTS "roleCalibrationFactors",
  DROP COLUMN IF EXISTS "confidenceLevel",
  DROP COLUMN IF EXISTS "sampleSize";

-- AddTable: CalibrationAuditLog
CREATE TABLE IF NOT EXISTS "CalibrationAuditLog" (
  "id"                      TEXT NOT NULL,
  "workspaceId"             TEXT NOT NULL,
  "profileId"               TEXT NOT NULL,
  "appliedBy"               TEXT NOT NULL,
  "previousEstimateFactors" JSONB,
  "newEstimateFactors"      JSONB,
  "previousPricingFactors"  JSONB,
  "newPricingFactors"       JSONB,
  "reason"                  TEXT,
  "appliedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalibrationAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: CalibrationAuditLog → Workspace
ALTER TABLE "CalibrationAuditLog"
  ADD CONSTRAINT "CalibrationAuditLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CalibrationAuditLog → TeamCalibrationProfile
ALTER TABLE "CalibrationAuditLog"
  ADD CONSTRAINT "CalibrationAuditLog_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "TeamCalibrationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS "CalibrationAuditLog_workspaceId_idx"
  ON "CalibrationAuditLog"("workspaceId");
CREATE INDEX IF NOT EXISTS "CalibrationAuditLog_profileId_idx"
  ON "CalibrationAuditLog"("profileId");
