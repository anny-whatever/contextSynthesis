import { z } from 'zod';
import { ITool, ToolResult, ToolConfig, ToolParameter, ToolDefinition, ToolExecutionOptions, ToolUsageMetrics } from '../types/tool';
import { TopicEmbeddingService } from '../services/topic-embedding-service';
import { PrismaClient } from '@prisma/client';

const semanticTopicSearchSchema = z.object({
  query: z.string().describe('The search query to find semantically similar topics'),
  limit: z.number().optional().default(5).describe('Maximum number of results to return'),
  threshold: z.number().optional().default(0.7).describe('Similarity threshold (0-1, higher = more similar)')
});

export class SemanticTopicSearchTool implements ITool {
  readonly config: ToolConfig = {
    name: 'semantic_topic_search',
    description: 'Search for conversation summaries using semantic similarity based on topic content',
    version: '1.0.0',
    enabled: true,
    timeout: 30000
  };

  readonly parameters: ToolParameter[] = [
    {
      name: 'query',
      type: 'string',
      description: 'The search query to find semantically similar topics',
      required: true,
      examples: ['authentication', 'database setup', 'API endpoints']
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum number of results to return',
      required: false,
      default: 5
    },
    {
      name: 'threshold',
      type: 'number',
      description: 'Similarity threshold (0-1, higher = more similar)',
      required: false,
      default: 0.7
    }
  ];

  readonly definition: ToolDefinition = {
    type: 'function',
    function: {
      name: this.config.name,
      description: this.config.description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to find semantically similar topics' },
          limit: { type: 'number', description: 'Maximum number of results to return', default: 5 },
          threshold: { type: 'number', description: 'Similarity threshold (0-1, higher = more similar)', default: 0.7 }
        },
        required: ['query']
      }
    }
  };

  constructor(
    private embeddingService: TopicEmbeddingService,
    private prisma: PrismaClient
  ) {}

  async execute(input: any, options?: ToolExecutionOptions): Promise<ToolResult> {
    const params = semanticTopicSearchSchema.parse(input);
    try {
      const { query, limit, threshold } = params;

      // Generate embedding for the search query
      const queryEmbedding = await this.embeddingService.generateTopicEmbedding(query);
      
      if (queryEmbedding.length === 0) {
        return {
          success: false,
          error: 'Failed to generate embedding for search query'
        };
      }

      // Search for similar topics using cosine similarity
      const results = await this.prisma.$queryRaw<{
        id: string;
        topicName: string;
        summaryText: string;
        conversationId: string;
        similarity: number;
        createdAt: Date;
      }[]>`
        SELECT 
          id,
          "topicName",
          "summaryText",
          "conversationId",
          1 - ("topicEmbedding" <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity,
          "createdAt"
        FROM conversation_summaries 
        WHERE "topicEmbedding" IS NOT NULL
          AND 1 - ("topicEmbedding" <=> ${`[${queryEmbedding.join(',')}]`}::vector) >= ${threshold}
        ORDER BY "topicEmbedding" <=> ${`[${queryEmbedding.join(',')}]`}::vector
        LIMIT ${limit}
      `;

      return {
        success: true,
        data: {
          query,
          results: results.map(result => ({
            id: result.id,
            topicName: result.topicName,
            summaryText: result.summaryText,
            conversationId: result.conversationId,
            similarity: Math.round(result.similarity * 100) / 100, // Round to 2 decimal places
            createdAt: result.createdAt
          })),
          totalFound: results.length
        }
      };

    } catch (error) {
      console.error('Error in semantic topic search:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async validate(input: any): Promise<boolean> {
    try {
      semanticTopicSearchSchema.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  async getUsageMetrics(): Promise<ToolUsageMetrics> {
    // Basic implementation - in production you'd track these metrics
    return {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageDuration: 0,
      lastUsed: new Date(),
      errorRate: 0
    };
  }
}