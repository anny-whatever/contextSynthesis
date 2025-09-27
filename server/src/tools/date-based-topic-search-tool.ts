import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ToolConfig, ToolParameter, ToolResult, ToolContext } from '../types/tool';
import { PrismaClient } from '@prisma/client';
import { TimeUtility, ParsedTimeQuery } from '../utils/time-utility';

const dateBasedTopicSearchSchema = z.object({
  query: z.string().describe('The time-based query (e.g., "yesterday", "last 5 days", "5th august 2025")'),
  conversationId: z.string().describe('The conversation ID to search within'),
  limit: z.number().optional().default(10).describe('Maximum number of results to return (max 10)'),
  includeHours: z.boolean().optional().default(false).describe('Include hour-level granularity in search')
});

export interface DateBasedTopicResult {
  id: string;
  conversationId: string;
  topicName: string;
  summaryText: string;
  relatedTopics: any;
  messageRange: any;
  topicRelevance: number;
  batchId: string | null;
  createdAt: Date;
  updatedAt: Date;
  timeMatch: 'exact' | 'within_range' | 'partial';
}

export class DateBasedTopicSearchTool extends BaseTool {
  constructor(prisma?: PrismaClient) {
    const config: ToolConfig = {
      name: 'date_based_topic_search',
      description: 'Search for conversation topics based on specific dates or date ranges with time awareness',
      version: '1.0.0',
      enabled: true,
      timeout: 30000
    };

    const parameters: ToolParameter[] = [
      {
        name: 'query',
        type: 'string',
        description: 'The time-based query (e.g., "yesterday", "last 5 days", "5th august 2025")',
        required: true,
        examples: ['yesterday', 'last 5 days', '5th august 2025', 'today', 'last week']
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
        description: 'Maximum number of results to return (max 10)',
        required: false,
        default: 10
      },
      {
        name: 'includeHours',
        type: 'boolean',
        description: 'Include hour-level granularity in search',
        required: false,
        default: false
      }
    ];

    super(config, parameters, prisma);
  }

  async executeInternal(input: any, context?: ToolContext): Promise<ToolResult> {
    try {
      const validatedInput = dateBasedTopicSearchSchema.parse(input);
      const { query, conversationId, limit, includeHours } = validatedInput;

      // Ensure limit doesn't exceed 10
      const actualLimit = Math.min(limit, 10);

      // Parse the time query
      const parsedTime = TimeUtility.parseTimeQuery(query);

      if (!parsedTime.isValid) {
        return {
          success: false,
          error: parsedTime.error || 'Could not parse time query',
          data: {
            query,
            parsedTime,
            suggestions: [
              'Try "yesterday" for topics from yesterday',
              'Try "last 5 days" for topics from the last 5 days',
              'Try "5th august 2025" for topics from a specific date',
              'Try "today" for topics from today'
            ]
          }
        };
      }

      // Handle date range limitation warning
      let warningMessage: string | undefined;
      if (!parsedTime.isValid && parsedTime.error) {
        warningMessage = parsedTime.error;
        // Use the corrected date range
        const correctedRange = this.getMaxAllowedRange();
        parsedTime.startDate = correctedRange.startDate;
        parsedTime.endDate = correctedRange.endDate;
        parsedTime.isValid = true;
      }

      // Count total topics in the date range first
      const totalCount = await this.countTopicsInDateRange(
        conversationId,
        parsedTime.startDate!,
        parsedTime.endDate!,
        includeHours
      );

      // Search for topics in the specified date range
      const topics = await this.searchTopicsByDateRange(
        conversationId,
        parsedTime.startDate!,
        parsedTime.endDate!,
        actualLimit,
        includeHours
      );

      // Determine if there are more topics available
      const hasMoreTopics = totalCount > actualLimit;
      const remainingCount = Math.max(0, totalCount - actualLimit);

      return {
        success: true,
        data: {
          query,
          parsedTime: {
            type: parsedTime.type,
            startDate: parsedTime.startDate,
            endDate: parsedTime.endDate,
            dayCount: parsedTime.dayCount,
            formattedRange: TimeUtility.formatDateRange(parsedTime.startDate!, parsedTime.endDate!)
          },
          topics,
          totalFound: totalCount,
          returned: topics.length,
          hasMoreTopics,
          remainingCount,
          warning: warningMessage
        },
        metadata: {
          searchType: 'date_based',
          dateRange: {
            start: parsedTime.startDate!.toISOString(),
            end: parsedTime.endDate!.toISOString()
          },
          includeHours,
          executionTime: Date.now()
        }
      };
    } catch (error) {
      console.error('Error in date-based topic search:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null
      };
    }
  }

  private async countTopicsInDateRange(
    conversationId: string,
    startDate: Date,
    endDate: Date,
    includeHours: boolean
  ): Promise<number> {
    const whereClause = this.buildDateWhereClause(conversationId, startDate, endDate, includeHours);
    
    const count = await this.prisma.conversationSummary.count({
      where: whereClause
    });

    return count;
  }

  private async searchTopicsByDateRange(
    conversationId: string,
    startDate: Date,
    endDate: Date,
    limit: number,
    includeHours: boolean
  ): Promise<DateBasedTopicResult[]> {
    const whereClause = this.buildDateWhereClause(conversationId, startDate, endDate, includeHours);

    const results = await this.prisma.conversationSummary.findMany({
      where: whereClause,
      orderBy: [
        { createdAt: 'desc' }, // Most recent first
        { topicRelevance: 'desc' } // Then by relevance
      ],
      take: limit,
      select: {
        id: true,
        conversationId: true,
        topicName: true,
        summaryText: true,
        relatedTopics: true,
        messageRange: true,
        topicRelevance: true,
        batchId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return results.map(result => ({
      ...result,
      timeMatch: this.determineTimeMatch(result.createdAt, startDate, endDate)
    }));
  }

  private buildDateWhereClause(
    conversationId: string,
    startDate: Date,
    endDate: Date,
    includeHours: boolean
  ) {
    const baseWhere = {
      conversationId,
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    };

    // If including hours, we can be more precise with the time range
    if (includeHours) {
      // For hour-level precision, we might want to adjust the date range
      // to include the full hours specified
      return baseWhere;
    }

    return baseWhere;
  }

  private determineTimeMatch(
    topicDate: Date,
    startDate: Date,
    endDate: Date
  ): 'exact' | 'within_range' | 'partial' {
    // Check if it's an exact day match
    if (TimeUtility.isSameDay(topicDate, startDate) && TimeUtility.isSameDay(startDate, endDate)) {
      return 'exact';
    }

    // Check if it's within the range
    if (topicDate >= startDate && topicDate <= endDate) {
      return 'within_range';
    }

    return 'partial';
  }

  private getMaxAllowedRange(): { startDate: Date, endDate: Date } {
    const endDate = TimeUtility.getCurrentDate();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - TimeUtility.getMaxDateRangeDays());
    
    return { startDate, endDate };
  }

  /**
   * Get current time for the AI agent (since AI doesn't have time perception)
   */
  async getCurrentTime(): Promise<ToolResult> {
    const now = TimeUtility.getCurrentDateTime();
    const currentDate = TimeUtility.getCurrentDate();
    
    return {
      success: true,
      data: {
        currentDateTime: now.toISOString(),
        currentDate: currentDate.toISOString(),
        formattedDateTime: now.toLocaleString(),
        formattedDate: TimeUtility.formatDate(currentDate),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      metadata: {
        purpose: 'time_awareness_for_ai',
        executionTime: Date.now()
      }
    };
  }
}