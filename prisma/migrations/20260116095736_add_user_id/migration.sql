/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `SystemSettings` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `SystemSettings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "validityDays" INTEGER DEFAULT 30;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "companyRepresentativeSealUrl" TEXT,
ADD COLUMN     "companySealUrl" TEXT,
ADD COLUMN     "roleRates" JSONB,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_userId_key" ON "SystemSettings"("userId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
