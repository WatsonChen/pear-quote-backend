-- EstimateSnapshot: add conversational refine lineage tracking
--
-- Changes:
--   1. ADD parentSnapshotId, revisionNumber (new columns)
--   2. DROP originalEstimateRange (renamed to rawGlobalEstimate in 20260623001000;
--      backfill verified in that migration before this DROP)
--   3. ADD self-relation FK with ON DELETE SET NULL
--   4. ADD unique index: one parent → one child (linear versioning only)
--   5. ADD regular index for lineage lookups

-- 1a. New column: parentSnapshotId (nullable, FK added in step 3)
ALTER TABLE "EstimateSnapshot"
  ADD COLUMN IF NOT EXISTS "parentSnapshotId" TEXT;

-- 1b. New column: revisionNumber (1 = first estimate, +1 per AI refine)
ALTER TABLE "EstimateSnapshot"
  ADD COLUMN IF NOT EXISTS "revisionNumber" INTEGER NOT NULL DEFAULT 1;

-- 2. Drop originalEstimateRange (safe: backfilled into rawGlobalEstimate in 20260623001000)
ALTER TABLE "EstimateSnapshot"
  DROP COLUMN IF EXISTS "originalEstimateRange";

-- 3. Self-relation FK: parentSnapshotId → EstimateSnapshot.id, SET NULL on parent delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EstimateSnapshot_parentSnapshotId_fkey'
  ) THEN
    ALTER TABLE "EstimateSnapshot"
      ADD CONSTRAINT "EstimateSnapshot_parentSnapshotId_fkey"
      FOREIGN KEY ("parentSnapshotId") REFERENCES "EstimateSnapshot"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Unique index: one parent → at most one child (linear versioning, no branching)
--    This unique index also serves as the lookup index (no separate regular index needed).
CREATE UNIQUE INDEX IF NOT EXISTS "EstimateSnapshot_parentSnapshotId_key"
  ON "EstimateSnapshot"("parentSnapshotId");
