import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ToolConfig, ToolParameter, ToolResult, ToolContext } from '../types/tool';
import { PrismaClient } from '@prisma/client';
import { TimeUtility } from '../utils/time-utility';

const topicCountSchema = z.object({
  conversationId: z.string().describe('The conversation ID to count topics within'),
  dateFilter: z.string().optional().describe('Date or date range filter (e.g., "yesterday", "last 5 days", "2025-08-05", "2025-08-05 to 2025-08-10")'),
  includeHours: z.boolean().optional().default(false).describe('Include hour-level granularity in date filtering'),
  semanticQuery: z.string().optional().describe('Optional semantic query to filter topics by similarity')
});

export class TopicCountTool extends BaseTool {
  constructor(prisma?: PrismaClient) {
    const config: ToolConfig = {
      name: 'count_topics',
      description: 'Count conversation topics within a date range or conversation, with optional semantic filtering',
      version: '1.0.0',
      enabled: true,
      timeout: 15000
    };

    const parameters: ToolParameter[] = [
      {
        name: 'conversationId',
        type: 'string',
        description: 'The conversation ID to count topics within',
        required: true
      },
      {
        name: 'dateFilter',
        type: 'string',
        description: 'Date or date range filter (e.g., "yesterday", "last 5 days", "2025-08-05", "2025-08-05 to 2025-08-10")',
        required: false,
        examples: ['yesterday', 'last 5 days', '2025-08-05', '2025-08-05 to 2025-08-10']
      },
      {
        name: 'includeHours',
        type: 'boolean',
        description: 'Include hour-level granularity in date filtering',
        required: false,
        default: false
      },
      {
        name: 'semanticQuery',
        type: 'string',
        description: 'Optional semantic query to filter topics by similarity',
        required: false,
        examples: ['authentication', 'database setup', 'API endpoints']
      }
    ];

    super(config, parameters, prisma);
  }

  async executeInternal(input: any, context?: ToolContext): Promise<ToolResult> {
    try {
      const validatedInput = topicCountSchema.parse(input);
      const { conversationId, dateFilter, includeHours, semanticQuery } = validatedInput;

      // Build base where conditions
      let whereConditions = ['cs."conversationId" = $1'];
      let queryParams: any[] = [conversationId];
      let paramIndex = 2;

      // Add date filtering if provided
      let timeResult: any = null;
      if (dateFilter) {
        timeResult = TimeUtility.parseTimeQuery(dateFilter);
        
        if (!timeResult.isValid) {
          return {
            success: false,
            error: `Invalid date filter: ${timeResult.error}`,
            data: null
          };
        }

        if (timeResult.startDate && timeResult.endDate) {
          // Date range
          if (includeHours) {
            whereConditions.push(`cs."createdAt" >= $${paramIndex} AND cs."createdAt" <= $${paramIndex + 1}`);
            queryParams.push(timeResult.startDate, timeResult.endDate);
            paramIndex += 2;
          } else {
            // Day-level granularity
            const startOfDay = new Date(timeResult.startDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(timeResult.endDate);
            endOfDay.setHours(23, 59, 59, 999);
            
            whereConditions.push(`cs."createdAt" >= $${paramIndex} AND cs."createdAt" <= $${paramIndex + 1}`);
            queryParams.push(startOfDay, endOfDay);
            paramIndex += 2;
          }
        } else if (timeResult.startDate) {
          // Single date
          if (includeHours) {
            const endDate = new Date(timeResult.startDate.getTime() + 60 * 60 * 1000); // Add 1 hour
            whereConditions.push(`cs."createdAt" >= $${paramIndex} AND cs."createdAt" < $${paramIndex + 1}`);
            queryParams.push(timeResult.startDate, endDate);
            paramIndex += 2;
          } else {
            // Day-level granularity
            const startOfDay = new Date(timeResult.startDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(timeResult.startDate);
            endOfDay.setHours(23, 59, 59, 999);
            
            whereConditions.push(`cs."createdAt" >= $${paramIndex} AND cs."createdAt" <= $${paramIndex + 1}`);
            queryParams.push(startOfDay, endOfDay);
            paramIndex += 2;
          }
        }
      }

      // Build the count query
      const countQuery = `
        SELECT COUNT(*) as total_count
        FROM conversation_summaries cs
        WHERE ${whereConditions.join(' AND ')}
      `;

      const countResult = await this.prisma.$queryRawUnsafe(countQuery, ...queryParams) as any[];
      const totalCount = parseInt(countResult[0]?.total_count || '0');

      // Get sample topics for preview (limit to 3 for efficiency)
      const sampleQuery = `
        SELECT 
          cs.id,
          cs."topicName",
          cs."summaryText",
          cs."createdAt",
          cs."topicRelevance"
        FROM conversation_summaries cs
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY cs."createdAt" DESC
        LIMIT 3
      `;

      const sampleTopics = await this.prisma.$queryRawUnsafe(sampleQuery, ...queryParams);

      // Calculate overflow information
      const maxRecommendedLimit = 10;
      const hasOverflow = totalCount > maxRecommendedLimit;
      const overflowCount = hasOverflow ? totalCount - maxRecommendedLimit : 0;

      // Provide recommendations based on count
      let recommendations: string[] = [];
      
      if (totalCount === 0) {
        recommendations.push('No topics found for the specified criteria');
        if (dateFilter) {
          recommendations.push('Try expanding the date range or removing date filters');
        }
      } else if (hasOverflow) {
        recommendations.push(`Found ${totalCount} topics, but only ${maxRecommendedLimit} will be returned by default`);
        recommendations.push('Consider narrowing your search with more specific date ranges or semantic queries');
        recommendations.push('You can request additional topics beyond the first 10 if needed');
      } else {
        recommendations.push(`Found ${totalCount} topics - all can be retrieved efficiently`);
      }

      return {
        success: true,
        data: {
          totalCount,
          hasOverflow,
          overflowCount,
          maxRecommendedLimit,
          sampleTopics: sampleTopics || [],
          recommendations,
          dateFilter: dateFilter || null,
          dateRange: timeResult ? {
            startDate: timeResult.startDate?.toISOString() || null,
            endDate: timeResult.endDate?.toISOString() || null,
            includeHours,
            type: timeResult.type
          } : null
        },
        metadata: {
          conversationId,
          dateFilter,
          includeHours,
          semanticQuery,
          executionTime: Date.now()
        }
      };
    } catch (error) {
      console.error('Error counting topics:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null
      };
    }
  }
}