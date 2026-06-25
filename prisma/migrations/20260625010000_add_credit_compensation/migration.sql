-- CreditCompensation: record failed credit refunds for manual retry
-- Written when prisma.workspace.update (refund) throws in refineEstimate catch block.
-- Operations: "refine_refund"
-- Status lifecycle: "pending" → "resolved" (manual or automated retry)

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

DO $$
BEGIN
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
