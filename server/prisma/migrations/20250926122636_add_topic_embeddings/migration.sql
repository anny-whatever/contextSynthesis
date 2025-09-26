-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "public"."conversation_summaries" ADD COLUMN     "topicEmbedding" vector(384);
