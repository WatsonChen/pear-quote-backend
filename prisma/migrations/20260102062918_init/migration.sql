/*
  Warnings:

  - You are about to drop the column `content` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Quote` table. All the data in the column will be lost.
  - Added the required column `customerName` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectName` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectType` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Quote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "content",
DROP COLUMN "title",
ADD COLUMN     "customerName" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "expectedDays" INTEGER,
ADD COLUMN     "projectName" TEXT NOT NULL,
ADD COLUMN     "projectType" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "totalAmount" DOUBLE PRECISION,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedHours" DOUBLE PRECISION NOT NULL,
    "suggestedRole" TEXT NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
