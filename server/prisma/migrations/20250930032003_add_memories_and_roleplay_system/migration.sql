-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."UsageOperationType" ADD VALUE 'MEMORY_EXTRACTION';
ALTER TYPE "public"."UsageOperationType" ADD VALUE 'ROLEPLAY_ENHANCEMENT';

-- AlterTable
ALTER TABLE "public"."conversations" ADD COLUMN     "behaviors" JSONB;

-- CreateTable
CREATE TABLE "public"."memories" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "category" TEXT NOT NULL,
    "keyValuePairs" JSONB NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidenceScore" DOUBLE PRECISION DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roleplays" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "baseRole" TEXT NOT NULL,
    "enhancedInstructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roleplays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_conversationId_category_idx" ON "public"."memories"("conversationId", "category");

-- CreateIndex
CREATE INDEX "memories_userId_category_idx" ON "public"."memories"("userId", "category");

-- CreateIndex
CREATE INDEX "memories_category_idx" ON "public"."memories"("category");

-- CreateIndex
CREATE INDEX "roleplays_conversationId_idx" ON "public"."roleplays"("conversationId");

-- CreateIndex
CREATE INDEX "roleplays_userId_idx" ON "public"."roleplays"("userId");

-- CreateIndex
CREATE INDEX "roleplays_isActive_idx" ON "public"."roleplays"("isActive");

-- AddForeignKey
ALTER TABLE "public"."memories" ADD CONSTRAINT "memories_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memories" ADD CONSTRAINT "memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roleplays" ADD CONSTRAINT "roleplays_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roleplays" ADD CONSTRAINT "roleplays_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
