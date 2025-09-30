/*
  Warnings:

  - The values [MEMORY_EXTRACTION] on the enum `UsageOperationType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `memories` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."UsageOperationType_new" AS ENUM ('AGENT_COMPLETION', 'INTENT_ANALYSIS', 'SUMMARIZATION', 'TOPIC_EXTRACTION', 'TOOL_CALL', 'EMBEDDING_GENERATION', 'BEHAVIORAL_MEMORY', 'ROLEPLAY_ENHANCEMENT');
ALTER TABLE "public"."usage_tracking" ALTER COLUMN "operationType" TYPE "public"."UsageOperationType_new" USING ("operationType"::text::"public"."UsageOperationType_new");
ALTER TYPE "public"."UsageOperationType" RENAME TO "UsageOperationType_old";
ALTER TYPE "public"."UsageOperationType_new" RENAME TO "UsageOperationType";
DROP TYPE "public"."UsageOperationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."memories" DROP CONSTRAINT "memories_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."memories" DROP CONSTRAINT "memories_userId_fkey";

-- DropTable
DROP TABLE "public"."memories";
