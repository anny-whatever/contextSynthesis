-- CreateEnum
CREATE TYPE "public"."UsageOperationType" AS ENUM ('AGENT_COMPLETION', 'INTENT_ANALYSIS', 'SUMMARIZATION', 'TOPIC_EXTRACTION', 'TOOL_CALL', 'EMBEDDING_GENERATION');

-- AlterTable
ALTER TABLE "public"."conversation_summaries" ADD COLUMN     "parentTopic" TEXT,
ADD COLUMN     "pointIndex" INTEGER,
ADD COLUMN     "sourceContext" TEXT DEFAULT 'mixed',
ADD COLUMN     "structuredContent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."usage_tracking" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "userId" TEXT,
    "operationType" "public"."UsageOperationType" NOT NULL,
    "operationSubtype" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "inputCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "outputCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "duration" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_tracking_conversationId_operationType_idx" ON "public"."usage_tracking"("conversationId", "operationType");

-- CreateIndex
CREATE INDEX "usage_tracking_userId_createdAt_idx" ON "public"."usage_tracking"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "usage_tracking_operationType_createdAt_idx" ON "public"."usage_tracking"("operationType", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_summaries_structuredContent_idx" ON "public"."conversation_summaries"("structuredContent");

-- CreateIndex
CREATE INDEX "conversation_summaries_parentTopic_idx" ON "public"."conversation_summaries"("parentTopic");

-- AddForeignKey
ALTER TABLE "public"."usage_tracking" ADD CONSTRAINT "usage_tracking_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_tracking" ADD CONSTRAINT "usage_tracking_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_tracking" ADD CONSTRAINT "usage_tracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
