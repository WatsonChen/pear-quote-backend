# Migration Runbook

## 工具說明與限制

| 工具 | 用途 | 限制 |
|------|------|------|
| `prisma/scripts/baseline_squash.sql` | 手動從零建立全部 schema | 不在 `migrations/` 目錄內，**不會被 `migrate deploy` 自動執行** |
| `prisma migrate deploy` | 部署尚未套用的 migration | **只適用已 baseline 的 DB**：必須先執行 baseline_squash.sql + `migrate resolve --applied` 後才能使用 |
| `prisma migrate resolve --applied` | 標記 migration 為已套用（不執行 DDL） | 只寫 `_prisma_migrations` 表格，不修改任何資料表 |

> **Fresh DB 注意：** `prisma migrate deploy` 對空 DB 執行會失敗，因為歷史 migration 鏈無法重播（Workspace/WorkspaceUser/Order 不在任何 migration 裡）。必須先跑 Runbook A 的完整流程。

---

## 背景說明

本專案歷史上大量使用 `prisma db push` 而非 `prisma migrate dev`，導致：
- `_prisma_migrations` 長期空白（至 2026-06-25 前）
- `Workspace`、`WorkspaceUser`、`Order` 等核心表格從未出現在任何 migration SQL 中
- `prisma migrate dev --create-only` 無法執行（shadow DB 無法重播遷移鏈）

**已完成（2026-06-25）：**  
所有 12 個 migration 已手動以 `migrate resolve --applied` baseline，  
並手寫 `20260625000000_add_snapshot_revision_lineage` 套用新欄位。  
`prisma migrate status` 現在顯示 "Database schema is up to date!"

---

## Runbook A：全新空 PostgreSQL — 建立完整 schema

**使用時機：** 新 staging 環境、CI 環境、本地測試 DB。

### 步驟

```bash
# 1. 準備一個空的 PostgreSQL database
psql -h <host> -U <user> -c "CREATE DATABASE pear_fresh;"

# 2. 執行 squashed baseline SQL（建立全部 12 張表）
psql -h <host> -U <user> -d pear_fresh \
  -f prisma/scripts/baseline_squash.sql

# 3. 初始化 Prisma migration tracking
DATABASE_URL="postgresql://<user>:<pass>@<host>/pear_fresh" \
  npx prisma migrate resolve --applied 20251216041525_init_schema

DATABASE_URL="..." npx prisma migrate resolve --applied 20260102062918_init
DATABASE_URL="..." npx prisma migrate resolve --applied 20260102074702_update_schema_ui
DATABASE_URL="..." npx prisma migrate resolve --applied 20260116095736_add_user_id
DATABASE_URL="..." npx prisma migrate resolve --applied 20260422000000_add_terms_acceptance_fields
DATABASE_URL="..." npx prisma migrate resolve --applied 20260429000000_add_proposal_sharing_fields
DATABASE_URL="..." npx prisma migrate resolve --applied 20260507000000_add_generation_type
DATABASE_URL="..." npx prisma migrate resolve --applied 20260507001000_add_quote_item_rate_metadata
DATABASE_URL="..." npx prisma migrate resolve --applied 20260616000000_add_estimation_baselines
DATABASE_URL="..." npx prisma migrate resolve --applied 20260623000000_add_calibration_tables
DATABASE_URL="..." npx prisma migrate resolve --applied 20260623001000_calibration_v2
DATABASE_URL="..." npx prisma migrate resolve --applied 20260625000000_add_snapshot_revision_lineage

# 4. 驗證狀態
DATABASE_URL="..." npx prisma migrate status
# 預期輸出：Database schema is up to date!

# 5. 生成 Prisma client
DATABASE_URL="..." npx prisma generate
```

### 快速驗證（確認 12 張表都存在）

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

預期看到：
```
CalibrationAuditLog
Customer
EstimateAdjustment
EstimateSnapshot
Order
Quote
QuoteItem
SystemSettings
TeamCalibrationProfile
User
Workspace
WorkspaceUser
_prisma_migrations
```

---

## Runbook B：既有 Production DB — 唯讀 schema drift 檢查

**使用時機：** 在 production 執行任何 `migrate resolve` 之前，必須先完成此檢查。  
**禁止事項：** 未完成本 runbook 的全部步驟前，不得執行任何會修改 DB 的指令。

### B-1：連線確認（唯讀）

```bash
# 確認你使用的是唯讀連線或有回滾計劃
# 下方所有 SQL 均為 SELECT 查詢，不修改任何資料
psql -h <prod-host> -U <readonly-user> -d <prod-db>
```

### B-2：確認核心表格存在

```sql
-- 必須全部出現
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'User','Workspace','WorkspaceUser','Order','Customer',
    'SystemSettings','Quote','QuoteItem',
    'EstimateSnapshot','EstimateAdjustment',
    'TeamCalibrationProfile','CalibrationAuditLog'
  )
ORDER BY table_name;
```

**通過條件：** 必須回傳 12 列。若有缺少，停止後續步驟。

### B-3：確認 EstimateSnapshot 新欄位已存在

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'EstimateSnapshot'
  AND column_name IN ('parentSnapshotId','revisionNumber','rawGlobalEstimate')
ORDER BY column_name;
```

**通過條件：**
- `parentSnapshotId` → character varying (TEXT), is_nullable = YES
- `rawGlobalEstimate` → jsonb, is_nullable = NO
- `revisionNumber` → integer, is_nullable = NO, column_default = 1

### B-4：確認 unique constraint 存在

```sql
SELECT conname, contype
FROM pg_constraint
WHERE conname IN (
  'EstimateSnapshot_parentSnapshotId_key',
  'EstimateSnapshot_parentSnapshotId_fkey'
);
```

**通過條件：** 必須回傳 2 列（一個 UNIQUE index `u`，一個 FK `f`）。

### B-5：確認 originalEstimateRange 已移除

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'EstimateSnapshot'
  AND column_name = 'originalEstimateRange';
```

**通過條件：** 回傳 0 列（欄位已被 20260625000000 migration 移除）。

### B-6：確認 _prisma_migrations tracking 狀態

```sql
SELECT migration_name, finished_at, applied_steps_count
FROM _prisma_migrations
ORDER BY migration_name;
```

**通過條件：**  
- 12 筆 migration 都出現（名稱前綴 20251216 ~ 20260625）  
- 全部 `finished_at` 非 NULL  
- 全部 `applied_steps_count` ≥ 1

若 `_prisma_migrations` 表格不存在：

```sql
-- 表示 migration tracking 從未初始化
-- 需執行 Runbook C 重新 baseline
```

### B-7：確認 Workspace 表格欄位（含 creditBalance）

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'Workspace'
ORDER BY column_name;
```

**通過條件：** 必須包含 `creditBalance` (integer, NOT NULL, default 20)。

---

## Runbook C：既有 Production DB — 執行 baseline（B 通過後才可執行）

**使用時機：** Runbook B 全部通過，且需要設定 `_prisma_migrations` tracking。

```bash
# 1. 確認連線設定
echo $DATABASE_URL  # 確認指向 production

# 2. 依序 baseline 所有既有 migration
# 注意：resolve 只寫入 _prisma_migrations 表格，不執行任何 DDL
npx prisma migrate resolve --applied 20251216041525_init_schema
npx prisma migrate resolve --applied 20260102062918_init
npx prisma migrate resolve --applied 20260102074702_update_schema_ui
npx prisma migrate resolve --applied 20260116095736_add_user_id
npx prisma migrate resolve --applied 20260422000000_add_terms_acceptance_fields
npx prisma migrate resolve --applied 20260429000000_add_proposal_sharing_fields
npx prisma migrate resolve --applied 20260507000000_add_generation_type
npx prisma migrate resolve --applied 20260507001000_add_quote_item_rate_metadata
npx prisma migrate resolve --applied 20260616000000_add_estimation_baselines
npx prisma migrate resolve --applied 20260623000000_add_calibration_tables
npx prisma migrate resolve --applied 20260623001000_calibration_v2
npx prisma migrate resolve --applied 20260625000000_add_snapshot_revision_lineage

# 3. 驗證
npx prisma migrate status
# 預期：Database schema is up to date!
```

---

## 未來新增 Migration 的正確流程

由於 shadow DB 仍無法重播整條 migration 鏈，新的 migration 繼續手寫 SQL：

```bash
# 1. 建立 migration 目錄（用 YYYYMMDDHHMMSS 命名）
mkdir -p prisma/migrations/20260701000000_my_change

# 2. 手寫 SQL（用 IF NOT EXISTS / DO $$...END $$ 確保冪等性）
vim prisma/migrations/20260701000000_my_change/migration.sql

# 3. 在 local dev DB 套用
npx prisma db execute --file prisma/migrations/20260701000000_my_change/migration.sql

# 4. 更新 schema.prisma 反映變更

# 5. 驗證 local dev
npx prisma migrate resolve --applied 20260701000000_my_change
npx prisma migrate status

# 6. 在 staging 驗證（重複步驟 3-5）

# 7. Production：先執行 Runbook B 確認現狀，再執行 migration SQL，最後 resolve
```
