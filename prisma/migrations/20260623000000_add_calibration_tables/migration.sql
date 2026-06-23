-- AddTable: EstimateSnapshot
CREATE TABLE IF NOT EXISTS "EstimateSnapshot" (
  "id"                    TEXT NOT NULL,
  "workspaceId"           TEXT NOT NULL,
  "quoteId"               TEXT,
  "baselineVersion"       TEXT NOT NULL DEFAULT '1',
  "detectedModules"       JSONB NOT NULL,
  "baselineHours"         JSONB NOT NULL,
  "complexityMultiplier"  DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "riskBuffer"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "originalEstimateRange" JSONB NOT NULL,
  "originalHoursRange"    JSONB NOT NULL,
  "confidenceScore"       DOUBLE PRECISION,
  "missingInfo"           JSONB,
  "projectRiskFlags"      JSONB,
  "requirementSpec"       JSONB,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstimateSnapshot_pkey" PRIMARY KEY ("id")
);

-- AddTable: EstimateAdjustment
CREATE TABLE IF NOT EXISTS "EstimateAdjustment" (
  "id"                    TEXT NOT NULL,
  "snapshotId"            TEXT NOT NULL,
  "workspaceId"           TEXT NOT NULL,
  "adjustedModules"       JSONB,
  "adjustedHoursByRole"   JSONB,
  "adjustedEstimateRange" JSONB,
  "adjustmentReason"      TEXT,
  "finalQuotedPrice"      DOUBLE PRECISION,
  "acceptedPrice"         DOUBLE PRECISION,
  "projectStatus"         TEXT NOT NULL DEFAULT 'draft',
  "scopeChanged"          BOOLEAN NOT NULL DEFAULT false,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstimateAdjustment_pkey" PRIMARY KEY ("id")
);

-- AddTable: TeamCalibrationProfile
CREATE TABLE IF NOT EXISTS "TeamCalibrationProfile" (
  "id"                            TEXT NOT NULL,
  "workspaceId"                   TEXT NOT NULL,
  "moduleCalibrationFactors"      JSONB,
  "roleCalibrationFactors"        JSONB,
  "projectTypeCalibrationFactors" JSONB,
  "confidenceLevel"               TEXT NOT NULL DEFAULT 'low',
  "sampleSize"                    INTEGER NOT NULL DEFAULT 0,
  "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamCalibrationProfile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: EstimateSnapshot → Workspace
ALTER TABLE "EstimateSnapshot"
  ADD CONSTRAINT "EstimateSnapshot_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: EstimateSnapshot → Quote (nullable)
ALTER TABLE "EstimateSnapshot"
  ADD CONSTRAINT "EstimateSnapshot_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: EstimateAdjustment → EstimateSnapshot
ALTER TABLE "EstimateAdjustment"
  ADD CONSTRAINT "EstimateAdjustment_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "EstimateSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: EstimateAdjustment → Workspace
ALTER TABLE "EstimateAdjustment"
  ADD CONSTRAINT "EstimateAdjustment_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: TeamCalibrationProfile → Workspace
ALTER TABLE "TeamCalibrationProfile"
  ADD CONSTRAINT "TeamCalibrationProfile_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- UniqueIndex: EstimateAdjustment.snapshotId (1-to-1)
CREATE UNIQUE INDEX IF NOT EXISTS "EstimateAdjustment_snapshotId_key"
  ON "EstimateAdjustment"("snapshotId");

-- UniqueIndex: TeamCalibrationProfile.workspaceId (1 profile per workspace)
CREATE UNIQUE INDEX IF NOT EXISTS "TeamCalibrationProfile_workspaceId_key"
  ON "TeamCalibrationProfile"("workspaceId");

-- Index: EstimateSnapshot lookup by workspace
CREATE INDEX IF NOT EXISTS "EstimateSnapshot_workspaceId_idx"
  ON "EstimateSnapshot"("workspaceId");

-- Index: EstimateAdjustment lookup by workspace
CREATE INDEX IF NOT EXISTS "EstimateAdjustment_workspaceId_idx"
  ON "EstimateAdjustment"("workspaceId");
