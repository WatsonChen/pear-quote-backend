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
DATABASE_URL="..." npx prisma migrate resolve --applied 20260625010000_add_credit_compensation

# 4. 驗證狀態
DATABASE_URL="..." npx prisma migrate status
# 預期輸出：Database schema is up to date!

# 5. 生成 Prisma client
DATABASE_URL="..." npx prisma generate
```

### 快速驗證（確認 13 張表都存在）

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
CreditCompensation
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
    'TeamCalibrationProfile','CalibrationAuditLog',
    'CreditCompensation'
  )
ORDER BY table_name;
```

**通過條件：** 必須回傳 13 列。若有缺少，停止後續步驟。

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

> **重要：** 不要以 total row count 作為通過標準。`_prisma_migrations` 可能包含 `rolled_back_at IS NOT NULL` 的歷史 rolled-back 紀錄（不是 active unfinished，不是 blocker）。

**Step 1 — 確認 active unfinished migration 數量為 0**

```sql
SELECT COUNT(*) AS active_unfinished
FROM "_prisma_migrations"
WHERE finished_at IS NULL
  AND rolled_back_at IS NULL;
```

**通過條件：** `active_unfinished = 0`

- `finished_at IS NULL AND rolled_back_at IS NULL` = 真正未完成的 migration（**blocker**）
- `finished_at IS NULL AND rolled_back_at IS NOT NULL` = 歷史 rolled-back 紀錄（非 blocker，不需處理）

若有 `active_unfinished > 0`：**停止**，須先手動處理後再繼續。

---

**Step 2 — 確認每一筆 expected migration 的狀態**

```sql
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
  END AS status
FROM expected e
LEFT JOIN "_prisma_migrations" m USING (migration_name)
ORDER BY e.migration_name;
```

**通過條件：**

| status | 說明 | 是否通過 |
|--------|------|---------|
| `APPLIED` | 正常套用 | ✅ |
| `ROLLED_BACK` | 歷史 rolled-back 紀錄，可接受 | ✅ |
| `MISSING` | Schema 已存在但未記錄 tracking → 需跑 Runbook D | ⚠️ 見 Runbook D |
| `ACTIVE_UNFINISHED` | 真正卡住的未完成 migration | ❌ 停止 |

若 `_prisma_migrations` 表格不存在，此 SQL 會報錯 → 需執行完整 Runbook C 重新 baseline。

### B-7：確認 Workspace 表格欄位（含 creditBalance）

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'Workspace'
ORDER BY column_name;
```

**通過條件：** 必須包含 `creditBalance` (integer, NOT NULL, default 20)。

### B-8：確認 CreditCompensation 表格存在

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'CreditCompensation'
ORDER BY column_name;
```

**通過條件：** 必須回傳 8 列（id, workspaceId, amount, operation, status, error, createdAt, resolvedAt）。  
若回傳 0 列，表示 `20260625010000_add_credit_compensation` 尚未套用，須在 Runbook C 後執行該 migration SQL。

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
npx prisma migrate resolve --applied 20260625010000_add_credit_compensation

# 3. 驗證
npx prisma migrate status
# 預期：Database schema is up to date!
```

---

## Runbook D：Schema 已存在、migration tracking 部分缺失

**使用時機：** Runbook B schema checks（B-2 ～ B-8）全部 PASS，但 B-6 Step 2 顯示有 `MISSING` migration，且對應 schema 欄位/表格已確認存在。

> **此情境不執行任何 DDL / schema-changing SQL。**
> 只用 `migrate resolve --applied` 補齊 tracking 紀錄。
> **不要執行 `migrate deploy`**（schema 已存在，deploy 會嘗試重跑 DDL 並可能失敗或毀壞資料）。

### 前置確認（必須全部通過才可繼續）

- [ ] B-2：13 張表全部存在（含 CreditCompensation）
- [ ] B-3：EstimateSnapshot 有 parentSnapshotId / revisionNumber / rawGlobalEstimate
- [ ] B-4：parentSnapshotId unique constraint + FK 存在（2 列）
- [ ] B-5：originalEstimateRange 不存在（0 列）
- [ ] B-6 Step 1：`active_unfinished = 0`
- [ ] B-6 Step 2：無 `ACTIVE_UNFINISHED` migration
- [ ] B-7：Workspace.creditBalance 存在
- [ ] B-8：CreditCompensation 8 個欄位存在
- [ ] 確認 MISSING 的 migration 對應 schema 已在 B-3 ～ B-8 中驗證存在

### 執行 resolve

**僅 resolve 確認 MISSING 的 migration，逐一執行，不要批次：**

```bash
DATABASE_URL="<production_url>" npx prisma migrate resolve --applied 20260623000000_add_calibration_tables
DATABASE_URL="<production_url>" npx prisma migrate resolve --applied 20260623001000_calibration_v2
DATABASE_URL="<production_url>" npx prisma migrate resolve --applied 20260625000000_add_snapshot_revision_lineage
DATABASE_URL="<production_url>" npx prisma migrate resolve --applied 20260625010000_add_credit_compensation
```

### 不應執行的操作

- ❌ 不要 resolve `20260422000000_add_terms_acceptance_fields`（已在 `_prisma_migrations` 有 `rolled_back_at IS NOT NULL` 紀錄，不需重複操作）
- ❌ 不要 resolve 已是 `APPLIED` 狀態的 migration
- ❌ 不要執行 `migrate deploy`
- ❌ 不要執行任何 schema-changing SQL

### 驗證

```bash
DATABASE_URL="<production_url>" npx prisma migrate status
# 預期：Database schema is up to date!
# 20260422 若顯示 rolled back 不算 error，Prisma 可接受
```

resolve 完成後，重跑 B-6 Step 2，確認全部顯示 `APPLIED` 或 `ROLLED_BACK`，無 `MISSING`。

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
