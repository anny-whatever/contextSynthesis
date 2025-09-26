-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "public"."ToolStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "userId" TEXT,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "content" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cost" DOUBLE PRECISION,
    "metadata" JSONB,
    "summaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tool_usages" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "public"."ToolStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_summaries" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "topicName" TEXT NOT NULL,
    "summaryText" TEXT NOT NULL,
    "relatedTopics" JSONB,
    "messageRange" JSONB NOT NULL,
    "summaryLevel" INTEGER NOT NULL DEFAULT 1,
    "topicRelevance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."intent_analyses" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userMessageId" TEXT NOT NULL,
    "currentIntent" TEXT NOT NULL,
    "contextualRelevance" TEXT NOT NULL,
    "relationshipToHistory" TEXT NOT NULL,
    "keyTopics" JSONB NOT NULL,
    "pendingQuestions" JSONB NOT NULL,
    "lastAssistantQuestion" TEXT,
    "analysisResult" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "instructions" TEXT,
    "context" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "messages_conversationId_summaryId_idx" ON "public"."messages"("conversationId", "summaryId");

-- CreateIndex
CREATE INDEX "messages_summaryId_idx" ON "public"."messages"("summaryId");

-- CreateIndex
CREATE INDEX "conversation_summaries_conversationId_batchId_idx" ON "public"."conversation_summaries"("conversationId", "batchId");

-- CreateIndex
CREATE INDEX "conversation_summaries_topicName_idx" ON "public"."conversation_summaries"("topicName");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_sessionId_key" ON "public"."agent_sessions"("sessionId");

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "public"."conversation_summaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tool_usages" ADD CONSTRAINT "tool_usages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."intent_analyses" ADD CONSTRAINT "intent_analyses_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."intent_analyses" ADD CONSTRAINT "intent_analyses_userMessageId_fkey" FOREIGN KEY ("userMessageId") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
