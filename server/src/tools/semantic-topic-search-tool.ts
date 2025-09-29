import { z } from "zod";
import { BaseTool } from "./base-tool";
import {
  ToolConfig,
  ToolParameter,
  ToolResult,
  ToolContext,
} from "../types/tool";
import { TopicEmbeddingService } from "../services/topic-embedding-service";
import { PrismaClient } from "@prisma/client";
import { TimeUtility } from "../utils/time-utility";

const semanticTopicSearchSchema = z.object({
  query: z
    .string()
    .describe("The search query to find semantically similar topics"),
  conversationId: z.string().describe("The conversation ID to search within"),
  limit: z
    .number()
    .optional()
    .default(5)
    .describe("Maximum number of results to return"),
  threshold: z
    .number()
    .optional()
    .default(0.7)
    .describe("Similarity threshold (0-1, higher = more similar)"),
  dateFilter: z
    .string()
    .optional()
    .describe(
      'Date or date range filter (e.g., "yesterday", "last 5 days", "2025-08-05", "2025-08-05 to 2025-08-10")'
    ),
  includeHours: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include hour-level granularity in date filtering"),
  broaderTopics: z
    .array(z.string())
    .optional()
    .describe(
      "Broader topic categories to filter by (astronomy, anime, technology, etc.)"
    ),
});

export class SemanticTopicSearchTool extends BaseTool {
  private embeddingService: TopicEmbeddingService;

  constructor(embeddingService: TopicEmbeddingService, prisma?: PrismaClient) {
    const config: ToolConfig = {
      name: "semantic_topic_search",
      description:
        "Search for conversation summaries using semantic similarity based on topic content",
      version: "1.0.0",
      enabled: true,
      timeout: 30000,
    };

    const parameters: ToolParameter[] = [
      {
        name: "query",
        type: "string",
        description: "The search query to find semantically similar topics",
        required: true,
        examples: ["authentication", "database setup", "API endpoints"],
      },
      {
        name: "conversationId",
        type: "string",
        description: "The conversation ID to search within",
        required: true,
      },
      {
        name: "limit",
        type: "number",
        description: "Maximum number of results to return",
        required: false,
        default: 5,
      },
      {
        name: "threshold",
        type: "number",
        description: "Similarity threshold (0-1, higher = more similar)",
        required: false,
        default: 0.7,
      },
      {
        name: "dateFilter",
        type: "string",
        description:
          'Date or date range filter (e.g., "yesterday", "last 5 days", "2025-08-05", "2025-08-05 to 2025-08-10")',
        required: false,
        examples: [
          "yesterday",
          "last 5 days",
          "2025-08-05",
          "2025-08-05 to 2025-08-10",
        ],
      },
      {
        name: "includeHours",
        type: "boolean",
        description: "Include hour-level granularity in date filtering",
        required: false,
        default: false,
      },
      {
        name: "broaderTopics",
        type: "array",
        description:
          "Broader topic categories to filter by (astronomy, anime, technology, etc.)",
        required: false,
        examples: [["astronomy", "science"], ["anime"], ["technology", "work"]],
      },
    ];

    super(config, parameters, prisma);
    this.embeddingService = embeddingService;
  }

  async executeInternal(
    input: any,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const validatedInput = semanticTopicSearchSchema.parse(input);
      const {
        query,
        conversationId,
        limit,
        threshold,
        dateFilter,
        includeHours,
        broaderTopics,
      } = validatedInput;

      // Generate embedding for the search query (no usage tracking)
      const queryEmbedding = await this.embeddingService.generateQueryEmbedding(
        query
      );

      if (queryEmbedding.length === 0) {
        return {
          success: false,
          error: "Failed to generate embedding for search query",
          data: null,
        };
      }

      // Build date filter conditions
      let dateConditions = "";
      let dateParams: any[] = [];
      let timeResult: any = null;

      if (dateFilter) {
        timeResult = TimeUtility.parseTimeQuery(dateFilter);

        if (!timeResult.isValid) {
          return {
            success: false,
            error: `Invalid date filter: ${timeResult.error}`,
            data: null,
          };
        }

        if (timeResult.startDate && timeResult.endDate) {
          // Date range
          if (includeHours) {
            dateConditions = `AND cs."createdAt" >= $${
              dateParams.length + 1
            }::timestamp AND cs."createdAt" <= $${
              dateParams.length + 2
            }::timestamp`;
            dateParams.push(
              timeResult.startDate.toISOString(),
              timeResult.endDate.toISOString()
            );
          } else {
            // Day-level granularity
            const startOfDay = new Date(timeResult.startDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(timeResult.endDate);
            endOfDay.setHours(23, 59, 59, 999);

            dateConditions = `AND cs."createdAt" >= $${
              dateParams.length + 1
            }::timestamp AND cs."createdAt" <= $${
              dateParams.length + 2
            }::timestamp`;
            dateParams.push(startOfDay.toISOString(), endOfDay.toISOString());
          }
        } else if (timeResult.startDate) {
          // Single date
          if (includeHours) {
            const endDate = new Date(
              timeResult.startDate.getTime() + 60 * 60 * 1000
            ); // Add 1 hour
            dateConditions = `AND cs."createdAt" >= $${
              dateParams.length + 1
            }::timestamp AND cs."createdAt" < $${
              dateParams.length + 2
            }::timestamp`;
            dateParams.push(
              timeResult.startDate.toISOString(),
              endDate.toISOString()
            );
          } else {
            // Day-level granularity
            const startOfDay = new Date(timeResult.startDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(timeResult.startDate);
            endOfDay.setHours(23, 59, 59, 999);

            dateConditions = `AND cs."createdAt" >= $${
              dateParams.length + 1
            }::timestamp AND cs."createdAt" <= $${
              dateParams.length + 2
            }::timestamp`;
            dateParams.push(startOfDay.toISOString(), endOfDay.toISOString());
          }
        }
      }

      // Build broader topic filter conditions
      let broaderTopicConditions = "";
      if (broaderTopics && broaderTopics.length > 0) {
        const broaderTopicPlaceholders = broaderTopics
          .map((_, index) => `$${4 + dateParams.length + index + 1}`)
          .join(", ");
        broaderTopicConditions = `AND cs."broaderTopic" IN (${broaderTopicPlaceholders})`;
      }

      // Build the query with date and broader topic filtering
      const queryText = `
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
          cs."broaderTopic",
          cs."createdAt",
          cs."updatedAt",
          (cs."topicEmbedding" <=> $1::vector) as similarity_score
        FROM conversation_summaries cs
        WHERE cs."topicEmbedding" IS NOT NULL
          AND cs."conversationId" = $2
          AND (cs."topicEmbedding" <=> $1::vector) <= $3
          ${dateConditions}
          ${broaderTopicConditions}
        ORDER BY similarity_score ASC, cs."createdAt" DESC
        LIMIT $${4 + dateParams.length + (broaderTopics?.length || 0)}
      `;

      const queryParams = [
        `[${queryEmbedding.join(",")}]`,
        conversationId,
        1 - threshold,
        ...dateParams,
        ...(broaderTopics || []),
        limit,
      ];

      const results = await this.prisma.$queryRawUnsafe(
        queryText,
        ...queryParams
      );

      return {
        success: true,
        data: {
          query,
          results: results || [],
          count: Array.isArray(results) ? results.length : 0,
          dateFilter: dateFilter || null,
          dateRange: dateFilter
            ? {
                startDate: timeResult?.startDate?.toISOString() || null,
                endDate: timeResult?.endDate?.toISOString() || null,
                includeHours,
              }
            : null,
        },
        metadata: {
          searchQuery: query,
          threshold,
          limit,
          dateFilter,
          includeHours,
          broaderTopics: broaderTopics || null,
          executionTime: Date.now(),
        },
      };
    } catch (error) {
      console.error("Error in semantic topic search:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        data: null,
      };
    }
  }
}
