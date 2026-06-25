#!/usr/bin/env bash
# =============================================================================
# resolve_missing_migrations.template.sh
#
# ⚠️  TEMPLATE ONLY — 不可直接執行。
#     必須先閱讀並確認每一個步驟，再手動逐行執行。
#
# 使用時機：
#   production DB schema 已存在，但 _prisma_migrations 缺少 4 支 tracking 紀錄：
#     - 20260623000000_add_calibration_tables
#     - 20260623001000_calibration_v2
#     - 20260625000000_add_snapshot_revision_lineage
#     - 20260625010000_add_credit_compensation
#
# 參照：prisma/scripts/RUNBOOK.md，Runbook D
#       prisma/scripts/production_migration_tracking_check.sql（先執行）
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# ⚠️  警告：不可將 unknown 或未確認的 DATABASE_URL 貼入此處後直接執行
#     必須先確認 URL 指向正確的 production Neon DB
# ─────────────────────────────────────────────────────────────────────────────
DATABASE_URL="REPLACE_WITH_YOUR_PRODUCTION_DATABASE_URL"

# ─────────────────────────────────────────────────────────────────────────────
# 前置確認 checklist（手動逐項確認，不通過不繼續）
# ─────────────────────────────────────────────────────────────────────────────
# [ ] production_migration_tracking_check.sql 所有查詢已在 Neon SQL Editor 跑過
# [ ] [1] 核心表格：13 列 PASS
# [ ] [2] EstimateSnapshot 新欄位：3 列 PASS
# [ ] [3] unique constraint + FK：2 列 PASS
# [ ] [4] originalEstimateRange：0 列 PASS
# [ ] [5] Workspace.creditBalance：存在 PASS
# [ ] [6] CreditCompensation：8 列 PASS
# [ ] [7] active_unfinished = 0 PASS
# [ ] [8] MISSING migration 僅有以下 4 支，無 ACTIVE_UNFINISHED
#         - 20260623000000_add_calibration_tables
#         - 20260623001000_calibration_v2
#         - 20260625000000_add_snapshot_revision_lineage
#         - 20260625010000_add_credit_compensation
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Step 1：resolve 4 支 MISSING migration（逐一執行，確認每一條回應再繼續）
#
# 注意：
#   - 這些 resolve 只寫入 _prisma_migrations 表格，不執行任何 DDL
#   - 不要 resolve 20260422000000_add_terms_acceptance_fields
#     （已有 rolled_back_at IS NOT NULL 紀錄，不需重複操作）
# ─────────────────────────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL}" npx prisma migrate resolve --applied 20260623000000_add_calibration_tables
DATABASE_URL="${DATABASE_URL}" npx prisma migrate resolve --applied 20260623001000_calibration_v2
DATABASE_URL="${DATABASE_URL}" npx prisma migrate resolve --applied 20260625000000_add_snapshot_revision_lineage
DATABASE_URL="${DATABASE_URL}" npx prisma migrate resolve --applied 20260625010000_add_credit_compensation

# ─────────────────────────────────────────────────────────────────────────────
# Step 2：驗證
# 預期輸出：Database schema is up to date!
# 若 20260422000000 顯示 rolled back：Prisma 不視為 error，可接受
# ─────────────────────────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL}" npx prisma migrate status

# ─────────────────────────────────────────────────────────────────────────────
# Step 3：在 Neon SQL Editor 重跑 production_migration_tracking_check.sql [10]
#         確認 missing_migration = 0 列
# ─────────────────────────────────────────────────────────────────────────────
