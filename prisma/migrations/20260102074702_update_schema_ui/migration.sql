-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "totalCost" DOUBLE PRECISION,
ADD COLUMN     "totalMargin" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "description" TEXT,
    "aiSummary" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL,
    "companyName" TEXT,
    "taxId" TEXT,
    "contactEmail" TEXT,
    "juniorRate" DOUBLE PRECISION,
    "seniorRate" DOUBLE PRECISION,
    "pmRate" DOUBLE PRECISION,
    "designRate" DOUBLE PRECISION,
    "targetMarginMin" DOUBLE PRECISION,
    "targetMarginMax" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
