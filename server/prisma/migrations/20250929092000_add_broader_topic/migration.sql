-- AlterTable
ALTER TABLE "public"."conversation_summaries" ADD COLUMN     "broaderTopic" TEXT;

-- CreateIndex
CREATE INDEX "conversation_summaries_broaderTopic_idx" ON "public"."conversation_summaries"("broaderTopic");

-- CreateIndex
CREATE INDEX "conversation_summaries_broaderTopic_createdAt_idx" ON "public"."conversation_summaries"("broaderTopic", "createdAt");
