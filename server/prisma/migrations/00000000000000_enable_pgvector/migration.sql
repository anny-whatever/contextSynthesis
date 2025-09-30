-- Enable pgvector extension
-- This migration ensures the vector extension is available before any migrations that use vector columns
CREATE EXTENSION IF NOT EXISTS vector;