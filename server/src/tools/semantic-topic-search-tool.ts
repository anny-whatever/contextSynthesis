import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ToolConfig, ToolParameter, ToolResult, ToolContext } from '../types/tool';
import { TopicEmbeddingService } from '../services/topic-embedding-service';
import { PrismaClient } from '@prisma/client';

const semanticTopicSearchSchema = z.object({
  query: z.string().describe('The search query to find semantically similar topics'),
  conversationId: z.string().describe('The conversation ID to search within'),
  limit: z.number().optional().default(5).describe('Maximum number of results to return'),
  threshold: z.number().optional().default(0.7).describe('Similarity threshold (0-1, higher = more similar)')
});

export class SemanticTopicSearchTool extends BaseTool {
  private embeddingService: TopicEmbeddingService;

  constructor(embeddingService: TopicEmbeddingService, prisma?: PrismaClient) {
    const config: ToolConfig = {
      name: 'semantic_topic_search',
      description: 'Search for conversation summaries using semantic similarity based on topic content',
      version: '1.0.0',
      enabled: true,
      timeout: 30000
    };

    const parameters: ToolParameter[] = [
      {
        name: 'query',
        type: 'string',
        description: 'The search query to find semantically similar topics',
        required: true,
        examples: ['authentication', 'database setup', 'API endpoints']
      },
      {
        name: 'conversationId',
        type: 'string',
        description: 'The conversation ID to search within',
        required: true
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

    super(config, parameters, prisma);
    this.embeddingService = embeddingService;
  }

  async executeInternal(input: any, context?: ToolContext): Promise<ToolResult> {
    try {
      const validatedInput = semanticTopicSearchSchema.parse(input);
      const { query, conversationId, limit, threshold } = validatedInput;

      // Generate embedding for the search query
      const queryEmbedding = await this.embeddingService.generateTopicEmbedding(query);

      if (queryEmbedding.length === 0) {
        return {
          success: false,
          error: 'Failed to generate embedding for search query',
          data: null
        };
      }

      // Search for similar topics using cosine similarity within the specific conversation
      const results = await this.prisma.$queryRaw`
        SELECT 
          cs.id,
          cs."conversationId",
          cs."topicName",
          cs."summaryText",
          cs."relatedTopics",
          cs."messageRange",
          cs."summaryLevel",
          cs."topicRelevance",
          cs."batchId",
          cs."createdAt",
          cs."updatedAt",
          (cs."topicEmbedding" <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity_score
        FROM conversation_summaries cs
        WHERE cs."topicEmbedding" IS NOT NULL
          AND cs."conversationId" = ${conversationId}
          AND (cs."topicEmbedding" <=> ${`[${queryEmbedding.join(',')}]`}::vector) <= ${1 - threshold}
        ORDER BY similarity_score ASC
        LIMIT ${limit}
      `;

      return {
        success: true,
        data: {
          query,
          results: results || [],
          count: Array.isArray(results) ? results.length : 0
        },
        metadata: {
          searchQuery: query,
          threshold,
          limit,
          executionTime: Date.now()
        }
      };
    } catch (error) {
      console.error('Error in semantic topic search:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null
      };
    }
  }

}