import {
  ToolExecutionContext,
  ToolResultMetadata,
  ContextualizedToolResult,
  ToolCallReasoning,
  StructuredSystemPrompt,
  SystemPromptSection,
} from "../types/tool-context";
import { IntentAnalysisResult } from "./intent-analysis-service";

export class ToolContextService {
  /**
   * Creates contextualized tool result with rich explanatory information
   */
  createContextualizedResult(
    toolName: string,
    userQuery: string,
    intentAnalysis: IntentAnalysisResult,
    rawResult: any,
    metadata: ToolResultMetadata,
    reasoning: ToolCallReasoning
  ): ContextualizedToolResult {
    const context: ToolExecutionContext = {
      toolName,
      purpose: this.generatePurposeExplanation(
        toolName,
        userQuery,
        intentAnalysis
      ),
      userQuery,
      searchStrategy: reasoning.searchStrategy.strategy,
      timestamp: new Date().toISOString(),
      confidence: reasoning.toolSelection.confidence,
      totalFound: metadata.resultCount,
      searchQueries: reasoning.searchStrategy.queries,
      interpretationGuide: this.generateInterpretationGuide(
        toolName,
        rawResult,
        intentAnalysis
      ),
      executionReason: reasoning.toolSelection.reason,
    };

    const formattedExplanation = this.formatToolExplanation(
      context,
      rawResult,
      metadata
    );
    const usageInstructions = this.generateUsageInstructions(
      toolName,
      rawResult,
      intentAnalysis
    );

    return {
      context,
      metadata,
      rawResult,
      formattedExplanation,
      usageInstructions,
    };
  }

  /**
   * Generates clear purpose explanation for why a tool was called
   */
  private generatePurposeExplanation(
    toolName: string,
    userQuery: string,
    intentAnalysis: IntentAnalysisResult
  ): string {
    const toolPurposes: Record<string, string> = {
      date_based_topic_search: `User asked "${userQuery}" which contains temporal references. Searching conversation history for topics from specific dates/times.`,
      semantic_topic_search: `User asked "${userQuery}" which references specific topics from past conversations. Searching for semantically similar content.`,
      web_search: `User asked "${userQuery}" which requires current information not available in conversation history.`,
      conversation_summary: `User requested summary or overview of conversation topics.`,
    };

    return (
      toolPurposes[toolName] ||
      `User query "${userQuery}" triggered ${toolName} to gather relevant context.`
    );
  }

  /**
   * Generates interpretation guide for how to use tool results
   */
  private generateInterpretationGuide(
    toolName: string,
    rawResult: any,
    intentAnalysis: IntentAnalysisResult
  ): string {
    const guides: Record<string, string> = {
      date_based_topic_search: `These are conversation summaries from the requested time period. Use them to answer the user's recall question about what was discussed during that time.`,
      semantic_topic_search: `These are conversation summaries related to the topics the user mentioned. Use them to provide context and answer questions about those specific subjects.`,
      web_search: `These are current web search results. Combine with conversation context to provide up-to-date information.`,
      conversation_summary: `These are high-level summaries of conversation topics. Use them to provide overview or identify patterns.`,
    };

    return (
      guides[toolName] ||
      `Use these results to enhance your response to the user's query.`
    );
  }

  /**
   * Formats tool explanation in a clear, structured way
   */
  private formatToolExplanation(
    context: ToolExecutionContext,
    rawResult: any,
    metadata: ToolResultMetadata
  ): string {
    const timeFormatted = new Date(context.timestamp).toLocaleString();

    let explanation = `🔧 TOOL EXECUTION CONTEXT\n`;
    explanation += `Tool: ${context.toolName}\n`;
    explanation += `Purpose: ${context.purpose}\n`;
    explanation += `Search Strategy: ${context.searchStrategy}\n`;
    explanation += `Executed: ${timeFormatted}\n`;

    if (context.searchQueries.length > 0) {
      explanation += `Search Queries: ${context.searchQueries.join(", ")}\n`;
    }

    explanation += `Results Found: ${context.totalFound}\n`;
    explanation += `Confidence: ${(context.confidence * 100).toFixed(1)}%\n`;

    if (metadata.dateRange) {
      explanation += `Date Range: ${metadata.dateRange.startDate} to ${metadata.dateRange.endDate}\n`;
    }

    explanation += `\n📋 HOW TO USE THESE RESULTS\n`;
    explanation += `${context.interpretationGuide}\n`;

    return explanation;
  }

  /**
   * Generates specific usage instructions for the AI
   */
  private generateUsageInstructions(
    toolName: string,
    rawResult: any,
    intentAnalysis: IntentAnalysisResult
  ): string {
    const instructions: Record<string, string> = {
      date_based_topic_search: `Reference these summaries when answering the user's recall question. Mention specific topics and timeframes found. If no exact matches, suggest related topics from nearby dates.`,
      semantic_topic_search: `Use these summaries to provide detailed information about the topics the user mentioned. Reference specific conversations and provide context from our discussion history.`,
      web_search: `Cite these sources when providing current information. Combine with conversation context for comprehensive answers.`,
      conversation_summary: `Use these summaries to provide overview responses or identify conversation patterns and themes.`,
    };

    return (
      instructions[toolName] ||
      `Incorporate these results naturally into your response to address the user's query.`
    );
  }

  /**
   * Creates structured system prompt with clear sections
   */
  createStructuredSystemPrompt(
    baseIdentity: string,
    toolContexts: ContextualizedToolResult[],
    conversationContext: any,
    intentAnalysis?: IntentAnalysisResult
  ): StructuredSystemPrompt {
    const identity: SystemPromptSection = {
      title: "CORE IDENTITY",
      content: baseIdentity,
      priority: "critical" as const,
      order: 1,
    };

    const toolContextSections: SystemPromptSection[] = toolContexts.map(
      (toolResult, index) => ({
        title: `TOOL CONTEXT: ${toolResult.context.toolName.toUpperCase()}`,
        content: this.formatToolContextSection(toolResult),
        priority: "high" as const,
        order: 2 + index,
      })
    );

    const conversationContextSection: SystemPromptSection = {
      title: "CONVERSATION CONTEXT",
      content: this.formatConversationContext(conversationContext),
      priority: "high" as const,
      order: 10,
    };

    const responseGuidelines: SystemPromptSection = {
      title: "RESPONSE GUIDELINES",
      content: this.generateResponseGuidelines(toolContexts, intentAnalysis),
      priority: "medium" as const,
      order: 20,
    };

    const confidenceAssessment = intentAnalysis
      ? {
          title: "CONFIDENCE ASSESSMENT",
          content: this.formatConfidenceAssessment(intentAnalysis),
          priority: "medium" as const,
          order: 15,
        }
      : undefined;

    const structuredPrompt: StructuredSystemPrompt = {
      identity,
      toolContext: toolContextSections,
      conversationContext: conversationContextSection,
      responseGuidelines,
    };

    if (confidenceAssessment) {
      structuredPrompt.confidenceAssessment = confidenceAssessment;
    }

    return structuredPrompt;
  }

  /**
   * Formats tool context section for system prompt
   */
  private formatToolContextSection(
    toolResult: ContextualizedToolResult
  ): string {
    const { context, metadata, rawResult } = toolResult;

    let section = `• PURPOSE: ${context.purpose}\n`;
    section += `• SEARCH: ${context.searchStrategy}\n`;

    if (context.searchQueries.length > 0) {
      section += `• QUERIES: ${context.searchQueries.join(", ")}\n`;
    }

    section += `• RESULTS: Found ${context.totalFound} items\n`;

    if (metadata.dateRange) {
      section += `• TIMEFRAME: ${metadata.dateRange.startDate} to ${metadata.dateRange.endDate}\n`;
    }

    section += `• CONFIDENCE: ${(context.confidence * 100).toFixed(1)}%\n`;
    section += `• USAGE: ${context.interpretationGuide}\n`;

    // Add actual results summary
    if (rawResult?.data?.results || rawResult?.data?.topics) {
      const results = rawResult.data.results || rawResult.data.topics;
      section += `• FOUND TOPICS: ${results
        .map((r: any) => r.topicName || r.title)
        .slice(0, 3)
        .join(", ")}`;
      if (results.length > 3) section += ` (and ${results.length - 3} more)`;
      section += `\n`;
    }

    return section;
  }

  /**
   * Formats conversation context section
   */
  private formatConversationContext(conversationContext: any): string {
    let section = `• Recent messages available (last 2 turns)\n`;
    section += `• Use tool results above for historical context\n`;
    section += `• Conversation ID: ${
      conversationContext.conversationId || "N/A"
    }\n`;

    if (conversationContext.messageHistory) {
      section += `• Total messages in history: ${conversationContext.messageHistory.length}\n`;
    }

    return section;
  }

  /**
   * Generates response guidelines based on tool contexts
   */
  private generateResponseGuidelines(
    toolContexts: ContextualizedToolResult[],
    intentAnalysis?: IntentAnalysisResult
  ): string {
    let guidelines = `• Answer naturally and conversationally\n`;
    guidelines += `• Reference tool results when relevant\n`;

    if (toolContexts.some((tc) => tc.context.toolName.includes("search"))) {
      guidelines += `• Mention specific topics/timeframes found in search results\n`;
      guidelines += `• If no exact matches, suggest related topics found\n`;
    }

    if (intentAnalysis?.needsHistoricalContext) {
      guidelines += `• Use historical context to provide comprehensive answers\n`;
    }

    guidelines += `• Ask for clarification if search results don't match user's intent\n`;
    guidelines += `• Be helpful and maintain conversation flow\n`;

    return guidelines;
  }

  /**
   * Formats confidence assessment section
   */
  private formatConfidenceAssessment(
    intentAnalysis: IntentAnalysisResult
  ): string {
    let section = `• Overall Confidence: ${(
      intentAnalysis.confidenceScore * 100
    ).toFixed(1)}%\n`;
    section += `• Intent: ${intentAnalysis.currentIntent}\n`;
    section += `• Key Topics: ${intentAnalysis.keyTopics.join(", ")}\n`;

    if (intentAnalysis.confidenceFactors) {
      if (intentAnalysis.confidenceFactors.searchResultQuality !== undefined) {
        section += `• Search Quality: ${(
          intentAnalysis.confidenceFactors.searchResultQuality * 100
        ).toFixed(1)}%\n`;
      }
      if (intentAnalysis.confidenceFactors.historicalMatch !== undefined) {
        section += `• Context Match: ${(
          intentAnalysis.confidenceFactors.historicalMatch * 100
        ).toFixed(1)}%\n`;
      }
    }

    return section;
  }

  /**
   * Generates confidence assessment for tool results
   */
  private generateConfidenceAssessment(
    toolName: string,
    rawResult: any,
    metadata: ToolResultMetadata
  ): string {
    const resultCount = Array.isArray(rawResult)
      ? rawResult.length
      : rawResult?.summaries?.length || rawResult?.results?.length || 0;

    const confidence = metadata.confidence || 0.8;
    const confidenceLevel =
      confidence > 0.9 ? "HIGH" : confidence > 0.7 ? "MEDIUM" : "LOW";

    const searchQueriesText = metadata.searchQueries
      ? `Searched for: ${metadata.searchQueries.join(", ")}`
      : "";

    return `CONFIDENCE: ${confidenceLevel} (${Math.round(
      confidence * 100
    )}%) - Found ${resultCount} relevant ${
      resultCount === 1 ? "result" : "results"
    }. ${searchQueriesText}`;
  }

  /**
   * Converts structured prompt to final string format
   */
  /**
   * Builds structured system prompt from conversation context (for use in prepareMessagesForOpenAI)
   */
  buildStructuredSystemPrompt(
    baseIdentity: string,
    conversationContext: any,
    intentAnalysis?: IntentAnalysisResult
  ): StructuredSystemPrompt {
    // For now, we don't have tool contexts in prepareMessagesForOpenAI since tools haven't been executed yet
    // This method creates a structured prompt from conversation summaries and intent analysis

    const identity: SystemPromptSection = {
      title: "CORE IDENTITY",
      content: baseIdentity,
      priority: "critical" as const,
      order: 1,
    };

    const conversationContextSection: SystemPromptSection = {
      title: "CONVERSATION CONTEXT",
      content: this.formatConversationContextFromMetadata(conversationContext),
      priority: "high" as const,
      order: 10,
    };

    const responseGuidelines: SystemPromptSection = {
      title: "RESPONSE GUIDELINES",
      content: this.generateResponseGuidelinesFromContext(
        conversationContext,
        intentAnalysis
      ),
      priority: "medium" as const,
      order: 20,
    };

    const confidenceAssessment = intentAnalysis
      ? {
          title: "CONFIDENCE ASSESSMENT",
          content: this.formatConfidenceAssessment(intentAnalysis),
          priority: "medium" as const,
          order: 15,
        }
      : undefined;

    const structuredPrompt: StructuredSystemPrompt = {
      identity,
      toolContext: [], // No tool contexts available yet since tools haven't been executed
      conversationContext: conversationContextSection,
      responseGuidelines,
    };

    if (confidenceAssessment) {
      structuredPrompt.confidenceAssessment = confidenceAssessment;
    }

    return structuredPrompt;
  }

  /**
   * Formats conversation context from metadata (summaries, smart context)
   */
  private formatConversationContextFromMetadata(
    conversationContext: any
  ): string {
    let content = "";

    // Add conversation summaries if available
    const summaries = conversationContext.metadata?.summaries;
    if (summaries && summaries.length > 0) {
      // Determine if this was from a specific search strategy
      const contextStrategy = conversationContext.metadata?.contextStrategy;
      const smartContext = conversationContext.metadata?.smartContext;
      const contextStats = conversationContext.metadata?.contextStats;

      // Format header based on search strategy
      if (contextStrategy === "date_based_search") {
        content += "## DATE-BASED SEARCH RESULTS\n";
        content += `🎯 SEARCH EXECUTED: Date-based topic search for "${
          smartContext?.dateQuery || "specific date"
        }"\n`;
        content += `📊 RESULTS: Found ${
          contextStats?.retrieved || 0
        } topics from the requested timeframe\n`;
        if (smartContext?.parsedTime) {
          const startDate = new Date(
            smartContext.parsedTime.startDate
          ).toLocaleDateString();
          const endDate = new Date(
            smartContext.parsedTime.endDate
          ).toLocaleDateString();
          content += `⏰ TIMEFRAME: ${
            startDate === endDate ? startDate : `${startDate} to ${endDate}`
          }\n`;
        }
        content += `🎬 YOUR TASK: Use these ${
          contextStats?.retrieved || 0
        } results to answer the user's question about the specific date(s) requested.\n\n`;
      } else if (contextStrategy === "semantic_search") {
        content += "## SEMANTIC SEARCH RESULTS\n";
        content += `🎯 SEARCH EXECUTED: Semantic search for topics related to user's query\n`;
        content += `📊 RESULTS: Found ${
          contextStats?.retrieved || 0
        } semantically related topics\n`;
        if (smartContext?.searchQueries) {
          content += `🔍 SEARCH TERMS: ${smartContext.searchQueries.join(
            ", "
          )}\n`;
        }
        content += `🎬 YOUR TASK: Use these ${
          contextStats?.retrieved || 0
        } results to provide comprehensive context for the user's question.\n\n`;
      } else {
        content += "## CONVERSATION HISTORY SUMMARIES\n";
        content +=
          "The following summaries provide context from earlier parts of this conversation:\n\n";
      }

      summaries.forEach((summary: any, index: number) => {
        const relatedTopicsStr = Array.isArray(summary.relatedTopics)
          ? summary.relatedTopics.join(", ")
          : "No related topics";

        content += `**Topic ${index + 1}:**\n`;
        content += `**Name**: ${summary.topicName}\n`;
        content += `**Content**: ${summary.summaryText}\n`;
        content += `**Related**: ${relatedTopicsStr}\n`;
        if (summary.timeMatch) {
          content += `**Time Match**: ${summary.timeMatch}\n`;
        }
        content += `**Covers**: ${
          summary.messageRange?.messageCount || 0
        } messages\n`;

        // Add timestamp information
        if (summary.createdAt) {
          const summaryDate = new Date(summary.createdAt);
          const now = new Date();
          const timeDiff = now.getTime() - summaryDate.getTime();
          const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

          const formattedDate = summaryDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });

          const formattedTime = summaryDate.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });

          let timeDescription;
          if (daysDiff === 0) {
            timeDescription = "0 days from today";
          } else if (daysDiff === 1) {
            timeDescription = "1 day from today";
          } else {
            timeDescription = `${daysDiff} days from today`;
          }

          content += `**Timestamp**: The conversation about this topic happened ${timeDescription}, that is on ${formattedDate} and ${formattedTime}\n`;
        }

        content += `\n`;
      });

      if (
        contextStrategy === "date_based_search" ||
        contextStrategy === "semantic_search"
      ) {
        const resultCount = contextStats?.retrieved || 0;
        if (resultCount > 0) {
          content += `✅ These ${resultCount} results were specifically retrieved to answer your query. Reference them directly in your response.\n\n`;
          content += `❗ CRITICAL INSTRUCTION: The topics listed above ARE the conversation content from the requested timeframe/search. When the user asks about past conversations, these results contain the information they're looking for. Do NOT say "no records found" - instead, reference the specific topics and details found above.\n\n`;
        } else {
          content += `❌ NO MATCHING RESULTS: The search returned 0 results. Tell the user that no matching conversations were found for their query and suggest alternative approaches.\n\n`;
        }
      } else {
        content +=
          "These summaries represent the conversation history. The recent messages below continue from where these summaries end.\n\n";
      }
    }

    // Add topic inference guidance if we have related but not exact matches
    const smartContext = conversationContext.metadata?.smartContext;
    if (
      smartContext?.suggestRelatedTopics &&
      !smartContext?.hasExactMatches &&
      summaries &&
      summaries.length > 0
    ) {
      content += "## TOPIC INFERENCE GUIDANCE\n";
      content +=
        "The user's query didn't find exact matches in our conversation history, but we found related topics that might be what they're referring to.\n\n";
      content += `**Related topics found**: ${summaries
        .map((s: any) => s.topicName)
        .join(", ")}\n`;
      content += `**Search queries used**: ${
        smartContext.searchQueries?.join(", ") || "N/A"
      }\n\n`;
      content +=
        'IMPORTANT: Instead of saying "no previous mentions found", acknowledge the related topics and ask for clarification. For example:\n';
      content +=
        '"I found some related discussions about [topic names]. Are you perhaps referring to our conversation about [specific topic]? If so, I can provide more details about that discussion."\n\n';
      content +=
        "This creates a more natural, human-like conversation flow where you help the user connect to the right topic.\n\n";
    }

    return content || "No conversation history summaries available.";
  }

  /**
   * Generates response guidelines from conversation context
   */
  private generateResponseGuidelinesFromContext(
    conversationContext: any,
    intentAnalysis?: IntentAnalysisResult
  ): string {
    let guidelines = "";

    const contextStrategy = conversationContext.metadata?.contextStrategy;
    const contextStats = conversationContext.metadata?.contextStats;
    const hasResults = contextStats?.retrieved > 0;

    if (
      contextStrategy === "date_based_search" ||
      contextStrategy === "semantic_search"
    ) {
      if (hasResults) {
        guidelines +=
          "• PRIORITY: Use the search results above to answer the user's question\n";
        guidelines +=
          "• The retrieved topics ARE the conversation content the user is asking about\n";
        guidelines +=
          "• Reference specific topic names, details, and timeframes from the results\n";
        guidelines +=
          "• Do NOT claim no information was found when results are provided above\n";
      } else {
        guidelines += "• No matching results found in conversation history\n";
        guidelines +=
          "• Acknowledge this clearly and suggest alternative approaches\n";
      }
    } else {
      guidelines +=
        "• Use conversation summaries to provide context-aware responses\n";
      guidelines +=
        "• If the user asks about past conversations or topics, reference the summaries\n";
    }

    if (intentAnalysis) {
      guidelines += `• Current user intent: ${intentAnalysis.currentIntent}\n`;
      guidelines += `• Context retrieval strategy: ${intentAnalysis.contextRetrievalStrategy}\n`;
      guidelines += `• Needs historical context: ${intentAnalysis.needsHistoricalContext}\n`;
    }

    return guidelines;
  }

  renderStructuredPrompt(structuredPrompt: StructuredSystemPrompt): string {
    const sections = [
      structuredPrompt.identity,
      ...structuredPrompt.toolContext,
      structuredPrompt.conversationContext,
      structuredPrompt.responseGuidelines,
    ];

    if (structuredPrompt.confidenceAssessment) {
      sections.splice(-1, 0, structuredPrompt.confidenceAssessment);
    }

    // Sort by order and render
    sections.sort((a, b) => a.order - b.order);

    return sections
      .map((section) => `## ${section.title}\n${section.content}`)
      .join("\n\n");
  }
}
