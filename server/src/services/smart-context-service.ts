import { PrismaClient } from "@prisma/client";
import { SemanticTopicSearchTool } from "../tools/semantic-topic-search-tool";
import { DateBasedTopicSearchTool } from "../tools/date-based-topic-search-tool";
import { IntentAnalysisResult, ToolExecutionPlan } from "./intent-analysis-service";

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  priority: "critical" | "high" | "medium" | "low";
  reasoning: string;
  metadata?: {
    resultCount?: number;
    confidence?: number;
    hasExactMatches?: boolean;
    searchQueries?: string[];
    dateQuery?: string;
    includeHours?: boolean;
    totalFound?: number;
    warning?: string;
    parsedTime?: any;
  };
}

export interface MultiToolExecutionResult {
  executionStrategy: "single" | "parallel" | "sequential" | "conditional";
  queryType: string;
  toolResults: ToolExecutionResult[];
  synthesizedResult: SmartContextResult;
  executionSummary: {
    totalTools: number;
    successfulTools: number;
    failedTools: number;
    totalExecutionTime: number;
    criticalToolsSucceeded: boolean;
    fallbacksUsed: string[];
  };
}

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
    source?: string; // NEW: Track which tool provided this result
    toolPriority?: string; // NEW: Track the priority of the tool that provided this
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
    // NEW: Multi-tool execution metadata
    multiToolExecution?: MultiToolExecutionResult;
    executionPlan?: ToolExecutionPlan[];
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
      toolExecutionPlan,
      executionStrategy,
      queryType,
      needsHistoricalContext,
      // Legacy fallback fields
      contextRetrievalStrategy,
      semanticSearchQueries,
      maxContextItems,
      keyTopics,
    } = intentAnalysis;

    // NEW: AI-driven multi-tool execution
    if (toolExecutionPlan && toolExecutionPlan.length > 0) {
      return await this.executeMultiToolPlan(
        conversationId,
        toolExecutionPlan,
        executionStrategy,
        queryType
      );
    }

    // LEGACY: Fallback to old single-tool execution for backward compatibility
    console.warn("🔄 [SMART CONTEXT] Using legacy single-tool execution - consider updating to multi-tool execution plan");
    
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

  // NEW: AI-driven multi-tool execution
  private async executeMultiToolPlan(
    conversationId: string,
    toolExecutionPlan: ToolExecutionPlan[],
    executionStrategy: "single" | "parallel" | "sequential" | "conditional",
    queryType: string
  ): Promise<SmartContextResult> {
    const startTime = Date.now();
    const toolResults: ToolExecutionResult[] = [];
    const fallbacksUsed: string[] = [];

    console.log(`🚀 [MULTI-TOOL] Executing ${executionStrategy} strategy with ${toolExecutionPlan.length} tools for query type: ${queryType}`);

    try {
      switch (executionStrategy) {
        case "single":
          if (toolExecutionPlan[0]) {
            const singleResult = await this.executeSingleTool(conversationId, toolExecutionPlan[0]);
            toolResults.push(singleResult);
          }
          break;

        case "parallel":
          const parallelResults = await this.executeToolsInParallel(conversationId, toolExecutionPlan);
          toolResults.push(...parallelResults);
          break;

        case "sequential":
          const sequentialResults = await this.executeToolsSequentially(conversationId, toolExecutionPlan);
          toolResults.push(...sequentialResults);
          break;

        case "conditional":
          const conditionalResults = await this.executeToolsConditionally(conversationId, toolExecutionPlan);
          toolResults.push(...conditionalResults);
          break;

        default:
          throw new Error(`Unknown execution strategy: ${executionStrategy}`);
      }

      // Handle fallbacks for failed critical tools
      const failedCriticalTools = toolResults.filter(
        result => !result.success && result.priority === "critical"
      );

      for (const failedTool of failedCriticalTools) {
        const originalPlan = toolExecutionPlan.find(plan => plan.toolName === failedTool.toolName);
        if (originalPlan?.fallbackTools && originalPlan.fallbackTools.length > 0) {
          console.log(`🔄 [FALLBACK] Executing fallback for failed critical tool: ${failedTool.toolName}`);
          
          for (const fallbackToolName of originalPlan.fallbackTools) {
            const fallbackPlan: ToolExecutionPlan = {
               toolName: fallbackToolName,
               priority: "high", // Fallbacks are high priority
               required: true,
               reasoning: `Fallback for failed critical tool: ${failedTool.toolName}`,
               parameters: originalPlan.parameters,
               timeout: originalPlan.timeout || 30000,
               retryCount: 1
             };

            const fallbackResult = await this.executeSingleTool(conversationId, fallbackPlan);
            if (fallbackResult.success) {
              toolResults.push(fallbackResult);
              fallbacksUsed.push(fallbackToolName);
              console.log(`✅ [FALLBACK] Successfully executed fallback: ${fallbackToolName}`);
              break; // Stop after first successful fallback
            }
          }
        }
      }

      // Synthesize results from all successful tools
      const synthesizedResult = await this.synthesizeMultiToolResults(
        conversationId,
        toolResults,
        queryType,
        toolExecutionPlan
      );

      const totalExecutionTime = Date.now() - startTime;
      const successfulTools = toolResults.filter(r => r.success).length;
      const failedTools = toolResults.filter(r => !r.success).length;
      const criticalToolsSucceeded = toolResults
        .filter(r => r.priority === "critical")
        .every(r => r.success);

      const multiToolExecution: MultiToolExecutionResult = {
        executionStrategy,
        queryType,
        toolResults,
        synthesizedResult: {} as SmartContextResult, // Remove circular reference
        executionSummary: {
          totalTools: toolResults.length,
          successfulTools,
          failedTools,
          totalExecutionTime,
          criticalToolsSucceeded,
          fallbacksUsed
        }
      };

      // Add multi-tool execution metadata to the result (without circular reference)
      synthesizedResult.metadata = {
        ...synthesizedResult.metadata,
        multiToolExecution,
        executionPlan: toolExecutionPlan
      };

      console.log(`🎯 [MULTI-TOOL] Execution completed:`, {
        strategy: executionStrategy,
        queryType,
        totalTools: toolResults.length,
        successful: successfulTools,
        failed: failedTools,
        executionTime: totalExecutionTime,
        criticalSuccess: criticalToolsSucceeded,
        fallbacksUsed: fallbacksUsed.length
      });

      return synthesizedResult;

    } catch (error) {
      console.error("❌ [MULTI-TOOL] Execution failed:", error);
      
      // Return fallback result
      return {
        summaries: [],
        retrievalMethod: "multi_tool_failed",
        totalAvailable: await this.getTotalSummariesCount(conversationId),
        retrieved: 0,
        metadata: {
          multiToolExecution: {
            executionStrategy,
            queryType,
            toolResults,
            synthesizedResult: {} as SmartContextResult,
            executionSummary: {
              totalTools: toolExecutionPlan.length,
              successfulTools: 0,
              failedTools: toolExecutionPlan.length,
              totalExecutionTime: Date.now() - startTime,
              criticalToolsSucceeded: false,
              fallbacksUsed
            }
          },
          executionPlan: toolExecutionPlan,
          warning: `Multi-tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      };
    }
  }

  private async executeSingleTool(
    conversationId: string,
    toolPlan: ToolExecutionPlan
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🔧 [TOOL] Executing ${toolPlan.toolName} with priority ${toolPlan.priority}`);
      
      let result: any;
      
      switch (toolPlan.toolName) {
        case "semantic_topic_search":
          result = await this.getSemanticContext(
            conversationId,
            toolPlan.parameters.semanticSearchQueries || [],
            toolPlan.parameters.maxContextItems || 5
          );
          break;

        case "date_based_topic_search":
          result = await this.getDateBasedContext(
            conversationId,
            toolPlan.parameters.dateQuery || "",
            toolPlan.parameters.maxContextItems || 10,
            toolPlan.parameters.includeHours || false
          );
          break;

        case "web_search":
          // Note: Web search tool would be implemented separately
          // For now, return a placeholder result
          console.log(`🌐 [WEB SEARCH] Would execute web search with query: ${toolPlan.parameters.webSearchQuery}`);
          result = {
            summaries: [],
            retrievalMethod: "web_search_placeholder",
            totalAvailable: 0,
            retrieved: 0,
            metadata: {
              warning: "Web search tool not yet implemented - placeholder result"
            }
          };
          break;

        default:
          throw new Error(`Unknown tool: ${toolPlan.toolName}`);
      }

      const executionTime = Date.now() - startTime;
      
      return {
        toolName: toolPlan.toolName,
        success: true,
        data: result,
        executionTime,
        priority: toolPlan.priority,
        reasoning: toolPlan.reasoning,
        metadata: {
          resultCount: result.retrieved || 0,
          confidence: result.confidence?.searchResultQuality || 0.5,
          hasExactMatches: result.metadata?.hasExactMatches || false,
          searchQueries: result.metadata?.searchQueries || [],
          dateQuery: result.metadata?.dateQuery,
          includeHours: result.metadata?.includeHours,
          totalFound: result.metadata?.totalFound,
          warning: result.metadata?.warning,
          parsedTime: result.metadata?.parsedTime
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ [TOOL] Failed to execute ${toolPlan.toolName}:`, error);
      
      return {
        toolName: toolPlan.toolName,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
        priority: toolPlan.priority,
        reasoning: toolPlan.reasoning
      };
    }
  }

  private async executeToolsInParallel(
    conversationId: string,
    toolPlans: ToolExecutionPlan[]
  ): Promise<ToolExecutionResult[]> {
    console.log(`⚡ [PARALLEL] Executing ${toolPlans.length} tools in parallel`);
    
    const promises = toolPlans.map(plan => this.executeSingleTool(conversationId, plan));
    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const plan = toolPlans[index];
        return {
          toolName: plan?.toolName || 'unknown',
          success: false,
          error: result.reason instanceof Error ? result.reason.message : 'Promise rejected',
          executionTime: 0,
          priority: plan?.priority || 'low',
          reasoning: plan?.reasoning || 'Unknown reasoning'
        };
      }
    });
  }

  private async executeToolsSequentially(
    conversationId: string,
    toolPlans: ToolExecutionPlan[]
  ): Promise<ToolExecutionResult[]> {
    console.log(`🔄 [SEQUENTIAL] Executing ${toolPlans.length} tools sequentially`);
    
    const results: ToolExecutionResult[] = [];
    
    for (const plan of toolPlans) {
      const result = await this.executeSingleTool(conversationId, plan);
      results.push(result);
      
      // If a critical tool fails, stop execution
      if (!result.success && plan.priority === "critical") {
        console.warn(`⚠️ [SEQUENTIAL] Critical tool ${plan.toolName} failed, stopping execution`);
        break;
      }
    }
    
    return results;
  }

  private async executeToolsConditionally(
    conversationId: string,
    toolPlans: ToolExecutionPlan[]
  ): Promise<ToolExecutionResult[]> {
    console.log(`🤔 [CONDITIONAL] Executing ${toolPlans.length} tools conditionally`);
    
    const results: ToolExecutionResult[] = [];
    
    for (const plan of toolPlans) {
      // Execute the tool
      const result = await this.executeSingleTool(conversationId, plan);
      results.push(result);
      
      // Conditional logic: if we get good results from a high-priority tool, 
       // we might skip lower priority tools
       if (result.success && plan.priority === "critical" && 
           result.metadata?.resultCount && result.metadata.resultCount > 0) {
        
        // Check if remaining tools are lower priority
        const remainingTools = toolPlans.slice(results.length);
        const hasOnlyLowerPriorityTools = remainingTools.every(
          t => t.priority === "low" || t.priority === "medium"
        );
        
        if (hasOnlyLowerPriorityTools) {
          console.log(`✅ [CONDITIONAL] Critical tool ${plan.toolName} succeeded with good results, skipping lower priority tools`);
          break;
        }
      }
    }
    
    return results;
  }

  private async synthesizeMultiToolResults(
    conversationId: string,
    toolResults: ToolExecutionResult[],
    queryType: string,
    originalPlan: ToolExecutionPlan[]
  ): Promise<SmartContextResult> {
    console.log(`🧬 [SYNTHESIS] Combining results from ${toolResults.length} tools for query type: ${queryType}`);
    
    const successfulResults = toolResults.filter(r => r.success && r.data);
    
    if (successfulResults.length === 0) {
      return {
        summaries: [],
        retrievalMethod: "multi_tool_no_results",
        totalAvailable: await this.getTotalSummariesCount(conversationId),
        retrieved: 0,
        metadata: {
          warning: "No successful tool executions"
        }
      };
    }

    // Combine summaries from all successful tools
    const allSummaries: any[] = [];
    let totalAvailable = 0;
    let hasExactMatches = false;
    const allSearchQueries: string[] = [];
    const allWarnings: string[] = [];
    
    // Priority-based synthesis: critical > high > medium > low
    const priorityOrder = ["critical", "high", "medium", "low"];
    
    for (const priority of priorityOrder) {
      const priorityResults = successfulResults.filter(r => r.priority === priority);
      
      for (const result of priorityResults) {
        const data = result.data as SmartContextResult;
        
        // Add source and priority information to summaries
        const sourcedSummaries = data.summaries.map(summary => ({
          ...summary,
          source: result.toolName,
          toolPriority: result.priority
        }));
        
        allSummaries.push(...sourcedSummaries);
        totalAvailable += data.totalAvailable;
        
        if (data.metadata?.hasExactMatches) {
          hasExactMatches = true;
        }
        
        if (data.metadata?.searchQueries) {
          allSearchQueries.push(...data.metadata.searchQueries);
        }
        
        if (data.metadata?.warning) {
          allWarnings.push(`${result.toolName}: ${data.metadata.warning}`);
        }
      }
    }

    // Remove duplicates based on content similarity (simple deduplication)
    const deduplicatedSummaries = this.deduplicateSummaries(allSummaries);
    
    // Calculate combined confidence
    const avgConfidence = successfulResults.reduce((sum, r) => {
      return sum + (r.metadata?.confidence || 0.5);
    }, 0) / successfulResults.length;

    const retrievalMethod = successfulResults.length > 1 
       ? `multi_tool_${queryType}` 
       : successfulResults[0]?.toolName || 'unknown';

    return {
      summaries: deduplicatedSummaries,
      retrievalMethod,
      totalAvailable,
      retrieved: deduplicatedSummaries.length,
      confidence: {
        searchResultQuality: avgConfidence,
        averageSimilarity: avgConfidence,
        hasStrongMatches: hasExactMatches,
        resultCount: deduplicatedSummaries.length,
        queryMatchRate: hasExactMatches ? 1.0 : avgConfidence
      },
      metadata: {
         hasExactMatches,
         searchQueries: [...new Set(allSearchQueries)], // Remove duplicate queries
         totalFound: deduplicatedSummaries.length,
         ...(allWarnings.length > 0 && { warning: allWarnings.join("; ") })
       }
    };
  }

  private deduplicateSummaries(summaries: any[]): any[] {
    const seen = new Set<string>();
    const deduplicated: any[] = [];
    
    for (const summary of summaries) {
      // Create a simple hash based on topic name and first 100 characters of summary text
      const hash = `${summary.topicName}_${summary.summaryText.substring(0, 100)}`;
      
      if (!seen.has(hash)) {
        seen.add(hash);
        deduplicated.push(summary);
      }
    }
    
    return deduplicated;
  }
}
