-- =============================================================================
-- production_migration_tracking_check.sql
--
-- 唯讀 drift check：在 Neon SQL Editor 或 psql 中直接貼上執行。
-- 所有查詢均為 SELECT，不修改任何資料。
--
-- 使用時機：執行 migrate resolve --applied 之前，確認 production DB 現況。
-- 參照：prisma/scripts/RUNBOOK.md，Runbook B 和 Runbook D。
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] 核心表格存在性（應回傳 13 列）
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  CASE WHEN table_name IS NOT NULL THEN 'PRESENT' END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'User','Workspace','WorkspaceUser','Order','Customer',
    'SystemSettings','Quote','QuoteItem',
    'EstimateSnapshot','EstimateAdjustment',
    'TeamCalibrationProfile','CalibrationAuditLog',
    'CreditCompensation'
  )
ORDER BY table_name;

-- 通過條件：回傳 13 列

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] EstimateSnapshot 新欄位（parentSnapshotId / revisionNumber / rawGlobalEstimate）
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'EstimateSnapshot'
  AND column_name IN ('parentSnapshotId','revisionNumber','rawGlobalEstimate')
ORDER BY column_name;

-- 通過條件：
--   parentSnapshotId  → character varying, is_nullable = YES
--   rawGlobalEstimate → jsonb, is_nullable = NO
--   revisionNumber    → integer, is_nullable = NO, column_default = 1

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] parentSnapshotId unique constraint + FK（應回傳 2 列）
-- ─────────────────────────────────────────────────────────────────────────────
SELECT conname, contype
FROM pg_constraint
WHERE conname IN (
  'EstimateSnapshot_parentSnapshotId_key',
  'EstimateSnapshot_parentSnapshotId_fkey'
);

-- 通過條件：2 列（contype = 'u' 和 contype = 'f'）

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] originalEstimateRange 已移除（應回傳 0 列）
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'EstimateSnapshot'
  AND column_name = 'originalEstimateRange';

-- 通過條件：0 列

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Workspace.creditBalance 存在
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'Workspace'
  AND column_name = 'creditBalance';

-- 通過條件：1 列，integer, NOT NULL, default 20

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] CreditCompensation 表格欄位（應回傳 8 列）
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'CreditCompensation'
ORDER BY column_name;

-- 通過條件：8 列（amount, createdAt, error, id, operation, resolvedAt, status, workspaceId）

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] Active unfinished migration 數量（應為 0）
--     注意：rolled_back_at IS NOT NULL 的紀錄不算 active unfinished
-- ─────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS active_unfinished
FROM "_prisma_migrations"
WHERE finished_at IS NULL
  AND rolled_back_at IS NULL;

-- 通過條件：0
-- 若 > 0：停止，須先手動處理 active unfinished migration

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] 每一筆 expected migration 的狀態
-- ─────────────────────────────────────────────────────────────────────────────
WITH expected(migration_name) AS (
  VALUES
    ('20251216041525_init_schema'),
    ('20260102062918_init'),
    ('20260102074702_update_schema_ui'),
    ('20260116095736_add_user_id'),
    ('20260422000000_add_terms_acceptance_fields'),
    ('20260429000000_add_proposal_sharing_fields'),
    ('20260507000000_add_generation_type'),
    ('20260507001000_add_quote_item_rate_metadata'),
    ('20260616000000_add_estimation_baselines'),
    ('20260623000000_add_calibration_tables'),
    ('20260623001000_calibration_v2'),
    ('20260625000000_add_snapshot_revision_lineage'),
    ('20260625010000_add_credit_compensation')
)
SELECT
  e.migration_name,
  CASE
    WHEN m.migration_name IS NULL     THEN 'MISSING'
    WHEN m.rolled_back_at IS NOT NULL THEN 'ROLLED_BACK'
    WHEN m.finished_at IS NULL        THEN 'ACTIVE_UNFINISHED'
    ELSE                                   'APPLIED'
  END AS status,
  m.finished_at,
  m.rolled_back_at
FROM expected e
LEFT JOIN "_prisma_migrations" m USING (migration_name)
ORDER BY e.migration_name;

-- 通過條件：
--   APPLIED       → 正常，繼續
--   ROLLED_BACK   → 歷史紀錄，可接受（不需處理）
--   MISSING       → 需執行 Runbook D：migrate resolve --applied
--   ACTIVE_UNFINISHED → 停止

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] Rolled-back migration 清單（純資訊，非 blocker）
-- ─────────────────────────────────────────────────────────────────────────────
SELECT migration_name, rolled_back_at, applied_steps_count
FROM "_prisma_migrations"
WHERE rolled_back_at IS NOT NULL
ORDER BY migration_name;

-- 這些紀錄存在是正常的，Prisma 不視為 error
-- 不要對這些 migration 重新執行 resolve --applied

-- ─────────────────────────────────────────────────────────────────────────────
-- [10] Missing expected migration 清單（快速彙總）
-- ─────────────────────────────────────────────────────────────────────────────
WITH expected(migration_name) AS (
  VALUES
    ('20251216041525_init_schema'),
    ('20260102062918_init'),
    ('20260102074702_update_schema_ui'),
    ('20260116095736_add_user_id'),
    ('20260422000000_add_terms_acceptance_fields'),
    ('20260429000000_add_proposal_sharing_fields'),
    ('20260507000000_add_generation_type'),
    ('20260507001000_add_quote_item_rate_metadata'),
    ('20260616000000_add_estimation_baselines'),
    ('20260623000000_add_calibration_tables'),
    ('20260623001000_calibration_v2'),
    ('20260625000000_add_snapshot_revision_lineage'),
    ('20260625010000_add_credit_compensation')
)
SELECT e.migration_name AS missing_migration
FROM expected e
LEFT JOIN "_prisma_migrations" m USING (migration_name)
WHERE m.migration_name IS NULL
ORDER BY e.migration_name;

-- 若回傳 0 列：所有 migration 都已記錄（tracking 完整）
-- 若回傳 > 0 列：這些 migration 需要執行 Runbook D 的 resolve --applied
