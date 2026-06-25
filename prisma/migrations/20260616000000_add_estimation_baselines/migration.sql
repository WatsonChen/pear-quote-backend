-- AlterTable: add nullable estimationBaselines column to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "estimationBaselines" JSONB;
