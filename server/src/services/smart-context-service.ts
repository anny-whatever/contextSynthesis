import { PrismaClient } from "@prisma/client";
import { SemanticTopicSearchTool } from "../tools/semantic-topic-search-tool";
import { IntentAnalysisResult } from "./intent-analysis-service";

export interface SmartContextResult {
  summaries: Array<{
    summaryText: string;
    topicName: string;
    relatedTopics: any;
    messageRange: any;
    summaryLevel: number;
    topicRelevance: number;
  }>;
  retrievalMethod: string;
  totalAvailable: number;
  retrieved: number;
}

export class SmartContextService {
  private prisma: PrismaClient;
  private semanticSearchTool: SemanticTopicSearchTool;

  constructor(
    prisma: PrismaClient,
    semanticSearchTool: SemanticTopicSearchTool
  ) {
    this.prisma = prisma;
    this.semanticSearchTool = semanticSearchTool;
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

      case "all_available":
        return await this.getAllContext(conversationId, maxContextItems || 10);

      default:
        return await this.getRecentContext(conversationId, 3, keyTopics);
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

    return {
      summaries,
      retrievalMethod: "recent_only",
      totalAvailable: totalCount,
      retrieved: summaries.length,
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

    // Perform semantic search for each query
    for (const query of searchQueries) {
      try {
        const searchResults = await this.semanticSearchTool.execute({
          query,
          conversationId,
          limit: Math.ceil(limit / searchQueries.length),
          threshold: 0.3,
        });

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
                topicRelevance: result.similarity,
              });
            }
          }
        }
      } catch (error) {
        console.error(`Semantic search failed for query "${query}":`, error);
      }
    }

    // Convert to array and sort by relevance
    const summaries = Array.from(summaryMap.values())
      .sort((a, b) => b.topicRelevance - a.topicRelevance)
      .slice(0, limit);

    const totalCount = await this.getTotalSummariesCount(conversationId);

    return {
      summaries,
      retrievalMethod: "semantic_search",
      totalAvailable: totalCount,
      retrieved: summaries.length,
    };
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
