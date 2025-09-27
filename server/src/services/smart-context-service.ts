import { PrismaClient } from "@prisma/client";
import { SemanticTopicSearchTool } from "../tools/semantic-topic-search-tool";
import { DateBasedTopicSearchTool } from "../tools/date-based-topic-search-tool";
import { IntentAnalysisResult } from "./intent-analysis-service";

export interface SmartContextResult {
  summaries: Array<{
    summaryText: string;
    topicName: string;
    relatedTopics: any;
    messageRange: any;
    summaryLevel: number;
    topicRelevance: number;
    createdAt?: string;
    isExactMatch?: boolean;
    timeMatch?: any;
  }>;
  retrievalMethod: string;
  totalAvailable: number;
  retrieved: number;
  confidence?: {
    searchResultQuality: number;
    averageSimilarity: number;
    hasStrongMatches: boolean;
    resultCount: number;
    queryMatchRate: number;
  };
  metadata?: {
    hasExactMatches?: boolean;
    searchQueries?: string[];
    suggestRelatedTopics?: boolean;
    dateQuery?: string;
    includeHours?: boolean;
    totalFound?: number;
    hasMoreTopics?: boolean;
    remainingCount?: number;
    warning?: string;
    parsedTime?: any;
  };
}

export class SmartContextService {
  private prisma: PrismaClient;
  private semanticSearchTool: SemanticTopicSearchTool;
  private dateBasedSearchTool: DateBasedTopicSearchTool;

  constructor(
    prisma: PrismaClient,
    semanticSearchTool: SemanticTopicSearchTool,
    dateBasedSearchTool?: DateBasedTopicSearchTool
  ) {
    this.prisma = prisma;
    this.semanticSearchTool = semanticSearchTool;
    this.dateBasedSearchTool =
      dateBasedSearchTool || new DateBasedTopicSearchTool(prisma);
  }

  async retrieveContext(
    conversationId: string,
    intentAnalysis: IntentAnalysisResult
  ): Promise<SmartContextResult> {
    const {
      contextRetrievalStrategy,
      needsHistoricalContext,
      semanticSearchQueries,
      maxContextItems,
      keyTopics,
    } = intentAnalysis;

    // If no historical context is needed, return empty
    if (!needsHistoricalContext || contextRetrievalStrategy === "none") {
      return {
        summaries: [],
        retrievalMethod: "none",
        totalAvailable: await this.getTotalSummariesCount(conversationId),
        retrieved: 0,
      };
    }

    switch (contextRetrievalStrategy) {
      case "recent_only":
        return await this.getRecentContext(
          conversationId,
          maxContextItems || 3,
          keyTopics
        );

      case "semantic_search":
        return await this.getSemanticContext(
          conversationId,
          semanticSearchQueries || [],
          maxContextItems || 5
        );

      case "date_based_search":
        return await this.getDateBasedContext(
          conversationId,
          intentAnalysis.dateQuery || "",
          intentAnalysis.maxContextItems || 10,
          intentAnalysis.includeHours || false
        );

      case "all_available":
        return await this.getAllContext(conversationId, maxContextItems || 10);

      default:
        console.warn(
          `Unknown context retrieval strategy: ${contextRetrievalStrategy}`
        );
        return await this.getRecentContext(
          conversationId,
          maxContextItems || 3
        );
    }
  }

  private async getRecentContext(
    conversationId: string,
    limit: number,
    keyTopics?: string[]
  ): Promise<SmartContextResult> {
    // If keyTopics are provided, filter by topic relevance first, then by recency
    let whereClause: any = { conversationId };

    if (keyTopics && keyTopics.length > 0) {
      // Extract individual keywords from key topics for more flexible matching
      const keywords = keyTopics.flatMap((topic) =>
        topic
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 2)
      );

      // Create OR conditions for flexible topic matching using individual keywords
      const keywordConditions = keywords
        .map((keyword) => [
          { topicName: { contains: keyword, mode: "insensitive" } },
          { summaryText: { contains: keyword, mode: "insensitive" } },
          { relatedTopics: { array_contains: keyword } },
        ])
        .flat();

      // Also include exact phrase matching for better precision
      const phraseConditions = keyTopics
        .map((topic) => [
          { topicName: { contains: topic, mode: "insensitive" } },
          { summaryText: { contains: topic, mode: "insensitive" } },
          { relatedTopics: { array_contains: topic } },
        ])
        .flat();

      whereClause.OR = [...keywordConditions, ...phraseConditions];
    }

    const summaries = await this.prisma.conversationSummary.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        summaryText: true,
        topicName: true,
        relatedTopics: true,
        messageRange: true,
        summaryLevel: true,
        topicRelevance: true,
      },
    });

    const totalCount = await this.getTotalSummariesCount(conversationId);

    // Calculate confidence for recent context
    const hasTopicFilter = keyTopics && keyTopics.length > 0;
    const resultRatio = summaries.length / limit;
    
    // For recent context, confidence is based on availability and topic matching
    let searchResultQuality = 0.6; // Base confidence for recent context
    if (hasTopicFilter) {
      // If we have topic filters and got results, increase confidence
      searchResultQuality = summaries.length > 0 ? 0.8 : 0.3;
    } else {
      // For pure recent context, confidence depends on how much we retrieved
      searchResultQuality = 0.4 + (resultRatio * 0.4); // 0.4 to 0.8 range
    }

    return {
      summaries,
      retrievalMethod: "recent_only",
      totalAvailable: totalCount,
      retrieved: summaries.length,
      confidence: {
        searchResultQuality,
        averageSimilarity: 0.5, // Default for recent context
        hasStrongMatches: Boolean(hasTopicFilter && summaries.length > 0),
        resultCount: summaries.length,
        queryMatchRate: hasTopicFilter ? (summaries.length > 0 ? 1 : 0) : 1,
      },
    };
  }

  private async getSemanticContext(
    conversationId: string,
    searchQueries: string[],
    limit: number
  ): Promise<SmartContextResult> {
    if (searchQueries.length === 0) {
      return await this.getRecentContext(conversationId, limit);
    }

    const allResults = new Set<string>();
    const summaryMap = new Map<string, any>();
    let hasExactMatches = false;

    // Perform semantic search for each query with different thresholds
    for (const query of searchQueries) {
      try {
        // First try with higher threshold for exact matches
        let searchResults = await this.semanticSearchTool.execute({
          query,
          conversationId,
          limit: Math.ceil(limit / searchQueries.length),
          threshold: 0.7, // Higher threshold for exact matches
        });

        // If no exact matches found, try with lower threshold for related topics
        if (
          !searchResults.success ||
          !searchResults.data ||
          searchResults.data.results.length === 0
        ) {
          searchResults = await this.semanticSearchTool.execute({
            query,
            conversationId,
            limit: Math.ceil(limit / searchQueries.length),
            threshold: 0.3, // Lower threshold for related topics
          });
        } else {
          hasExactMatches = true;
        }

        if (searchResults.success && searchResults.data) {
          for (const result of searchResults.data.results) {
            if (!allResults.has(result.topicName)) {
              allResults.add(result.topicName);
              summaryMap.set(result.topicName, {
                summaryText: result.summaryText,
                topicName: result.topicName,
                relatedTopics: result.relatedTopics,
                messageRange: result.messageRange,
                summaryLevel: result.summaryLevel,
                topicRelevance: result.similarity_score || result.similarity,
                createdAt: result.createdAt,
                isExactMatch: result.similarity_score >= 0.3, // Mark if it's a close match
              });
            }
          }
        }
      } catch (error) {
        console.error(`Semantic search failed for query "${query}":`, error);
      }
    }

    // Convert to array and sort by time first (recent first), then by relevance
    const summaries = Array.from(summaryMap.values())
      .sort((a, b) => {
        // First sort by creation time (recent first)
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        const timeDiff = timeB - timeA;

        // If time difference is significant (more than 1 hour), prioritize by time
        if (Math.abs(timeDiff) > 3600000) {
          return timeDiff;
        }

        // Otherwise, sort by relevance
        return b.topicRelevance - a.topicRelevance;
      })
      .slice(0, limit);

    const totalCount = await this.getTotalSummariesCount(conversationId);

    // Calculate confidence metrics
    const similarities = summaries.map(s => s.topicRelevance).filter(s => s !== undefined);
    const averageSimilarity = similarities.length > 0 ? similarities.reduce((a, b) => a + b, 0) / similarities.length : 0;
    const hasStrongMatches = similarities.some(s => s >= 0.7);
    const queryMatchRate = summaries.length > 0 ? summaries.length / searchQueries.length : 0;
    
    // Calculate overall search result quality (0-1 scale)
    let searchResultQuality = 0;
    if (summaries.length > 0) {
      const similarityScore = Math.min(averageSimilarity * 2, 1); // Scale similarity to 0-1
      const countScore = Math.min(summaries.length / limit, 1); // How many results we got vs requested
      const matchScore = hasStrongMatches ? 1 : 0.5; // Bonus for strong matches
      const queryScore = Math.min(queryMatchRate, 1); // How well we matched queries
      
      searchResultQuality = (similarityScore * 0.4 + countScore * 0.2 + matchScore * 0.3 + queryScore * 0.1);
    }

    return {
      summaries,
      retrievalMethod: "semantic_search",
      totalAvailable: totalCount,
      retrieved: summaries.length,
      confidence: {
        searchResultQuality,
        averageSimilarity,
        hasStrongMatches,
        resultCount: summaries.length,
        queryMatchRate,
      },
      metadata: {
        hasExactMatches,
        searchQueries,
        suggestRelatedTopics: !hasExactMatches && summaries.length > 0,
      },
    };
  }

  private async getDateBasedContext(
    conversationId: string,
    dateQuery: string,
    limit: number,
    includeHours: boolean
  ): Promise<SmartContextResult> {
    try {
      const searchResults = await this.dateBasedSearchTool.execute({
        query: dateQuery,
        conversationId,
        limit,
        includeHours,
      });

      if (!searchResults.success || !searchResults.data) {
        console.warn(
          `Date-based search failed for query "${dateQuery}":`,
          searchResults.error
        );
        // Fallback to recent context
        return await this.getRecentContext(conversationId, limit);
      }

      const { topics, totalFound, hasMoreTopics, remainingCount, warning } =
        searchResults.data;

      // Transform topics to match SmartContextResult format
      const summaries = topics.map((topic: any) => ({
        summaryText: topic.summaryText,
        topicName: topic.topicName,
        relatedTopics: topic.relatedTopics,
        messageRange: topic.messageRange,
        summaryLevel: 1, // Date-based searches typically return topic-level summaries
        topicRelevance: topic.topicRelevance || 0.8, // High relevance for date matches
        createdAt: topic.createdAt.toISOString(),
        timeMatch: topic.timeMatch,
      }));

      const totalCount = await this.getTotalSummariesCount(conversationId);

      return {
        summaries,
        retrievalMethod: "date_based_search",
        totalAvailable: totalCount,
        retrieved: summaries.length,
        metadata: {
          dateQuery,
          includeHours,
          totalFound,
          hasMoreTopics,
          remainingCount,
          warning,
          parsedTime: searchResults.data.parsedTime,
        },
      };
    } catch (error) {
      console.error(
        `Error in date-based context retrieval for query "${dateQuery}":`,
        error
      );
      // Fallback to recent context
      return await this.getRecentContext(conversationId, limit);
    }
  }

  private async getAllContext(
    conversationId: string,
    limit: number
  ): Promise<SmartContextResult> {
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { conversationId },
      orderBy: [{ summaryLevel: "asc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        summaryText: true,
        topicName: true,
        relatedTopics: true,
        messageRange: true,
        summaryLevel: true,
        topicRelevance: true,
      },
    });

    const totalCount = await this.getTotalSummariesCount(conversationId);

    return {
      summaries,
      retrievalMethod: "all_summaries",
      totalAvailable: totalCount,
      retrieved: summaries.length,
    };
  }

  private async getTotalSummariesCount(
    conversationId: string
  ): Promise<number> {
    return await this.prisma.conversationSummary.count({
      where: { conversationId },
    });
  }

  // Helper method to get context statistics for debugging
  async getContextStats(conversationId: string): Promise<{
    totalSummaries: number;
    summaryLevels: Record<number, number>;
    recentSummaries: number;
  }> {
    const totalSummaries = await this.getTotalSummariesCount(conversationId);

    const summaryLevels = await this.prisma.conversationSummary.groupBy({
      by: ["summaryLevel"],
      where: { conversationId },
      _count: { summaryLevel: true },
    });

    const recentSummaries = await this.prisma.conversationSummary.count({
      where: {
        conversationId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    const levelCounts: Record<number, number> = {};
    summaryLevels.forEach((level) => {
      levelCounts[level.summaryLevel] = level._count.summaryLevel;
    });

    return {
      totalSummaries,
      summaryLevels: levelCounts,
      recentSummaries,
    };
  }
}
