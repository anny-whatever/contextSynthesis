import OpenAI from "openai";
import { PrismaClient, Role } from "@prisma/client";
import { ToolRegistry } from "../tools/tool-registry";
import { CostService, TokenUsage, WebSearchUsage } from "./cost-service";
import {
  IntentAnalysisService,
  IntentAnalysisResult,
} from "./intent-analysis-service";
import {
  ConversationSummaryService,
  SummaryBatchResult,
} from "./conversation-summary-service";
import { SmartContextService } from "./smart-context-service";
import {
  AgentConfig,
  AgentRequest,
  AgentResponse,
  ConversationContext,
  MessageContext,
  ToolUsageContext,
} from "../types/agent";

export class AgentService {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private toolRegistry: ToolRegistry;
  private intentAnalysisService: IntentAnalysisService;
  private conversationSummaryService: ConversationSummaryService;
  private smartContextService: SmartContextService;
  private config: AgentConfig;

  constructor(
    openai?: OpenAI,
    prisma?: PrismaClient,
    toolRegistry?: ToolRegistry,
    config?: Partial<AgentConfig>
  ) {
    this.openai =
      openai ||
      new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

    this.prisma = prisma || new PrismaClient();
    this.toolRegistry =
      toolRegistry || new ToolRegistry(this.prisma, this.openai);
    this.intentAnalysisService = new IntentAnalysisService(
      this.prisma,
      this.openai
    );
    this.conversationSummaryService = new ConversationSummaryService(
      this.prisma,
      this.openai
    );

    // Initialize SmartContextService with both semantic and date-based search tools
    const semanticSearchTool = this.toolRegistry.getTool(
      "semantic_topic_search"
    );
    const dateBasedSearchTool = this.toolRegistry.getTool(
      "date_based_topic_search"
    );

    if (!semanticSearchTool) {
      throw new Error("SemanticTopicSearchTool not found in tool registry");
    }
    if (!dateBasedSearchTool) {
      throw new Error("DateBasedTopicSearchTool not found in tool registry");
    }

    this.smartContextService = new SmartContextService(
      this.prisma,
      semanticSearchTool as any,
      dateBasedSearchTool as any
    );

    this.config = {
      model: process.env.DEFAULT_AGENT_MODEL || "gpt-4o-mini",
      temperature: parseFloat(process.env.AGENT_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || "16384"),
      timeout: parseInt(process.env.AGENT_TIMEOUT_MS || "3000000000"),
      systemPrompt:
        process.env.AGENT_SYSTEM_PROMPT || this.getDefaultSystemPrompt(),
      enableTools: process.env.AGENT_ENABLE_TOOLS !== "false",
      maxConversationHistory: parseInt(
        process.env.MAX_CONVERSATION_HISTORY || "20"
      ),
      ...config,
    };
  }

  private getDefaultSystemPrompt(): string {
    return `You are a conversational AI assistant with excellent memory and natural communication skills. You remember our conversations and can recall topics we've discussed, even from long ago, with more recent topics being easier to access.

## CONVERSATION STYLE
- Communicate naturally like a knowledgeable friend, not in bullet points unless specifically requested
- Remember and reference our previous discussions when relevant
- When you're not completely sure about something from our past conversations, ask for clarification rather than assuming
- If you find related topics when searching your memory but they don't exactly match what the user asked about, suggest them: "I think you might be referring to [topic] that we discussed earlier. Is that what you meant?"

## MEMORY AND CONTEXT USAGE
- You have access to our entire conversation history through semantic search tools AND only the last 1 turn of our conversation is immediately available
- **CRITICAL: ALWAYS USE TOOLS FOR MEMORY SEARCHES**:
  * **For ANY recall questions**: ALWAYS use semantic_topic_search or date_based_topic_search tools to find information from our conversation history
  * **For general questions**: Use tools to search for relevant context before answering
  * **For continuation questions**: While you have the last turn available, still use tools if the user references anything beyond the immediate context
- **Tool Usage Priority**:
  * When user asks "what did we discuss about X", "remember when we talked about Y", "tell me about [topic]" → ALWAYS use semantic_topic_search
  * When user asks about specific dates/times like "yesterday", "last week", "on Monday" → ALWAYS use date_based_topic_search
  * When user asks general questions that might benefit from historical context → Use semantic_topic_search to find relevant background
  * Don't rely only on the minimal immediate context - actively search your memory
- **Context Strategy**:
  * Immediate context (last 1 turn) is minimal by design to encourage tool usage
  * Use tools proactively to gather comprehensive context for better responses
  * Combine tool search results with immediate context for complete understanding
- When users reference something we talked about before, ALWAYS use tools to search your memory
- If you can't find exactly what they're looking for with tools, try different search terms or ask for clarification

## INFORMATION GATHERING
- You have web search capabilities for current information
- Always cite sources when using web search results
- Combine your memory of our conversations with current information when helpful

## RESPONSE APPROACH
- Answer naturally and conversationally first
- Provide detailed explanations only when asked or when the topic is complex
- Ask follow-up questions to better understand what the user needs
- Be helpful, accurate, and maintain the flow of our ongoing conversation`;
  }

  async processMessage(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    let conversationId = request.conversationId;

    // Console logging: Initial request
    console.log("🚀 [AGENT] Processing new message request:", {
      timestamp: new Date().toISOString(),
      conversationId: conversationId || "NEW",
      userId: request.userId || "anonymous",
      messageLength: request.message.length,
      hasContext: !!request.context,
      options: request.options,
    });

    // Only create a new conversation if no conversationId is provided
    if (!conversationId) {
      conversationId = await this.createNewConversation(request.userId);
      console.log("📝 [AGENT] Created new conversation:", { conversationId });
    }

    try {
      // Load basic conversation context (without summaries for now)
      const basicContext = await this.loadConversationContext(
        conversationId,
        request.userId
      );

      console.log("📚 [AGENT] Loaded basic conversation context:", {
        conversationId,
        messageHistoryCount: basicContext.messageHistory.length,
        userId: basicContext.userId,
      });

      // Add user message to context
      const userMessage: MessageContext = {
        role: Role.USER,
        content: request.message,
        timestamp: new Date(),
      };
      basicContext.messageHistory.push(userMessage);

      // Save user message first to get its ID for intent analysis
      const savedUserMessage = await this.prisma.message.create({
        data: {
          conversationId: conversationId,
          role: userMessage.role,
          content: userMessage.content,
        },
      });

      // Perform intent analysis for every user message
      console.log("🧠 [AGENT] Performing intent analysis for user message");
      const intentAnalysis = await this.intentAnalysisService.analyzeIntent(
        conversationId,
        savedUserMessage.id,
        request.message
      );

      console.log("🧠 [AGENT] Intent analysis completed:", {
        currentIntent: intentAnalysis.currentIntent,
        contextualRelevance: intentAnalysis.contextualRelevance,
        relationshipToHistory: intentAnalysis.relationshipToHistory,
        keyTopics: intentAnalysis.keyTopics,
        needsHistoricalContext: intentAnalysis.needsHistoricalContext,
        contextRetrievalStrategy: intentAnalysis.contextRetrievalStrategy,
      });

      // Now load smart context based on intent analysis
      const smartContextResult = await this.loadSmartConversationContext(
        conversationId,
        intentAnalysis,
        request.userId
      );

      // Use the smart context for the rest of the processing
      const context = smartContextResult.context;
      const updatedIntentAnalysis = smartContextResult.updatedIntentAnalysis;

      // Prepare messages for OpenAI with intent analysis context
      const messages = this.prepareMessagesForOpenAI(context, updatedIntentAnalysis);

      // Console logging: System prompt and messages
      console.log("💬 [AGENT] Prepared messages for OpenAI:", {
        systemPrompt: messages[0].content, // Show full enhanced system prompt
        messageCount: messages.length,
        totalCharacters: JSON.stringify(messages).length,
      });

      console.log("📋 [AGENT] Full message payload:", {
        messages: messages.map((msg) => ({
          role: msg.role,
          contentLength: msg.content?.length || 0,
          content: msg.content, // Show full content instead of preview
        })),
      });

      // Get tools if enabled
      const tools =
        this.config.enableTools && request.options?.enableTools !== false
          ? this.toolRegistry.getToolDefinitions()
          : [];

      console.log("🔧 [AGENT] Tools configuration:", {
        toolsEnabled: this.config.enableTools,
        availableToolsCount: tools.length,
        toolNames: tools.map((t) => t.function.name),
      });

      // Call OpenAI API
      const model = request.options?.model || this.config.model;
      const completionParams: any = {
        model,
        messages,
        max_completion_tokens:
          request.options?.maxTokens || this.config.maxTokens,
      };

      // Only add temperature for models that support it (exclude o1 and some other models)

      if (tools.length > 0) {
        completionParams.tools = tools;
        completionParams.tool_choice = "auto";
      }

      console.log("🤖 [AGENT] Calling OpenAI API with params:", {
        model,
        messageCount: messages.length,
        maxTokens: completionParams.max_completion_tokens,
        toolsCount: tools.length,
        timestamp: new Date().toISOString(),
      });

      const completion = await this.openai.chat.completions.create(
        completionParams
      );

      console.log("✅ [AGENT] OpenAI API response received:", {
        model: completion.model,
        usage: completion.usage,
        finishReason: completion.choices[0]?.finish_reason,
        hasToolCalls: !!completion.choices[0]?.message?.tool_calls?.length,
        responseLength: completion.choices[0]?.message?.content?.length || 0,
      });

      const assistantMessage = completion.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error("No response from OpenAI");
      }

      // Handle tool calls if present
      const toolsUsed: ToolUsageContext[] = [];
      let finalContent = assistantMessage.content || "";
      let followUpCompletion: any = null;

      if (
        assistantMessage.tool_calls &&
        assistantMessage.tool_calls.length > 0
      ) {
        console.log("🔧 [AGENT] Processing tool calls:", {
          toolCallCount: assistantMessage.tool_calls.length,
          toolCalls: assistantMessage.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            functionName:
              tc.type === "function" ? (tc as any).function?.name : "unknown",
            argumentsLength:
              tc.type === "function"
                ? (tc as any).function?.arguments?.length || 0
                : 0,
          })),
        });

        const toolResults = await this.executeToolCalls(
          assistantMessage.tool_calls
        );
        toolsUsed.push(...toolResults);

        console.log("🔧 [AGENT] Tool execution completed:", {
          resultsCount: toolResults.length,
          successfulTools: toolResults.filter((r) => r.success).length,
          failedTools: toolResults.filter((r) => !r.success).length,
          totalDuration: toolResults.reduce((sum, r) => sum + r.duration, 0),
        });

        // Create follow-up completion with tool results
        const toolMessages = [
          ...messages,
          {
            role: "assistant" as const,
            content: assistantMessage.content,
            tool_calls: assistantMessage.tool_calls,
          },
          ...toolResults.map((result, index) => ({
            role: "tool" as const,
            tool_call_id:
              assistantMessage.tool_calls![index]?.id || `tool_${index}`,
            content: JSON.stringify(result.output),
          })),
        ];

        const followUpParams: any = {
          model,
          messages: toolMessages,
          max_completion_tokens:
            request.options?.maxTokens || this.config.maxTokens,
        };

        console.log("🤖 [AGENT] Making follow-up API call with tool results:", {
          model,
          messageCount: toolMessages.length,
          timestamp: new Date().toISOString(),
        });

        // Only add temperature for models that support it (exclude o1 and some other models)

        followUpCompletion = await this.openai.chat.completions.create(
          followUpParams
        );

        console.log("✅ [AGENT] Follow-up API response received:", {
          usage: followUpCompletion.usage,
          finishReason: followUpCompletion.choices[0]?.finish_reason,
          responseLength:
            followUpCompletion.choices[0]?.message?.content?.length || 0,
        });

        finalContent =
          followUpCompletion.choices[0]?.message?.content || finalContent;
      }

      // Calculate total token usage and cost
      let totalInputTokens = completion.usage?.prompt_tokens || 0;
      let totalOutputTokens = completion.usage?.completion_tokens || 0;

      if (followUpCompletion?.usage) {
        totalInputTokens += followUpCompletion.usage.prompt_tokens || 0;
        totalOutputTokens += followUpCompletion.usage.completion_tokens || 0;
      }

      const tokenUsage: TokenUsage = {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };

      // Calculate web search costs from tool results
      let totalWebSearchCalls = 0;
      let totalWebSearchCost = 0;

      toolsUsed.forEach((tool) => {
        if (
          tool.toolName === "web_search" &&
          tool.success &&
          tool.output?.metadata
        ) {
          const metadata = tool.output.metadata;
          if (metadata.webSearchCalls && metadata.webSearchCost) {
            totalWebSearchCalls += metadata.webSearchCalls;
            totalWebSearchCost += metadata.webSearchCost;
          }
        }
      });

      const webSearchUsage: WebSearchUsage | undefined =
        totalWebSearchCalls > 0
          ? {
              searchCalls: totalWebSearchCalls,
              model: model,
            }
          : undefined;

      const costCalculation = CostService.calculateCost(
        model,
        tokenUsage,
        webSearchUsage
      );

      console.log("💰 [AGENT] Cost calculation:", {
        model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        webSearchCalls: totalWebSearchCalls,
        webSearchCost: totalWebSearchCost,
        inputCost: costCalculation.inputCost,
        outputCost: costCalculation.outputCost,
        webSearchCostCalculated: costCalculation.webSearchCost,
        totalCost: costCalculation.totalCost,
        formattedCost: CostService.formatCost(costCalculation.totalCost),
      });

      // Add assistant message to context
      const assistantMessageContext: MessageContext = {
        role: Role.ASSISTANT,
        content: finalContent,
        timestamp: new Date(),
        toolUsages: toolsUsed,
      };
      context.messageHistory.push(assistantMessageContext);

      // Persist conversation (user message already saved for intent analysis)
      await this.persistConversation(
        context,
        savedUserMessage.id,
        assistantMessageContext,
        toolsUsed,
        costCalculation
      );

      // Check if we need to create a conversation summary AFTER assistant message is saved
      console.log("📊 [AGENT] Checking for conversation summarization");
      const summaryResult =
        await this.conversationSummaryService.checkAndCreateSummary(
          conversationId
        );

      if (summaryResult) {
        console.log("📊 [AGENT] Created conversation summary batch:", {
          batchId: summaryResult.batchId,
          topicCount: summaryResult.summaries.length,
          topics: summaryResult.summaries
            .map((s: any) => s.topicName)
            .join(", "),
        });
      } else {
        console.log(
          "📊 [AGENT] No summary created - threshold not met or other condition"
        );
      }

      const duration = Date.now() - startTime;

      console.log("🎯 [AGENT] Request completed successfully:", {
        conversationId,
        duration: `${duration}ms`,
        finalContentLength: finalContent.length,
        toolsUsedCount: toolsUsed.length,
        totalCost: CostService.formatCost(costCalculation.totalCost),
        timestamp: new Date().toISOString(),
      });

      return {
        message: finalContent,
        conversationId,
        toolsUsed,
        context,
        metadata: {
          model: request.options?.model || this.config.model,
          tokensUsed: totalInputTokens + totalOutputTokens,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cost: costCalculation.totalCost,
          duration,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      console.error("Agent service error:", error);
      throw new Error(
        `Failed to process message: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async executeToolCalls(
    toolCalls: any[]
  ): Promise<ToolUsageContext[]> {
    const results: ToolUsageContext[] = [];

    for (const toolCall of toolCalls) {
      const startTime = Date.now();

      try {
        const toolName = toolCall.function.name;
        const toolInput = JSON.parse(toolCall.function.arguments);

        const result = await this.toolRegistry.executeTool(toolName, toolInput);

        results.push({
          toolName,
          input: toolInput,
          output: result.success ? result : { error: result.error },
          success: result.success,
          duration: Date.now() - startTime,
          ...(result.success ? {} : { error: result.error }),
        });
      } catch (error) {
        results.push({
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
          output: null,
          success: false,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  }

  private prepareMessagesForOpenAI(
    context: ConversationContext,
    intentAnalysis?: IntentAnalysisResult
  ): any[] {
    let systemPrompt = this.config.systemPrompt;

    // Add conversation summaries as context if they exist
    const summaries = context.metadata?.summaries as any[];

    // Debug logging for summaries
    console.log("🔍 [DEBUG] Summary processing:", {
      hasSummaries: !!summaries,
      summariesLength: summaries?.length || 0,
      metadata: context.metadata,
      summariesData: summaries,
    });

    if (summaries && summaries.length > 0) {
      console.log(
        "📚 [SUMMARIES] Adding summaries to system prompt:",
        summaries.length
      );
      systemPrompt += `\n\n## CONVERSATION HISTORY SUMMARIES
The following summaries provide context from earlier parts of this conversation:

`;
      summaries.forEach((summary, index) => {
        console.log(`📚 [SUMMARY ${index + 1}] Adding summary:`, {
          level: summary.summaryLevel,
          messageCount: summary.messageRange?.messageCount,
          relatedTopics: summary.relatedTopics,
        });

        const relatedTopicsStr = Array.isArray(summary.relatedTopics)
          ? summary.relatedTopics.join(", ")
          : "No related topics";

        systemPrompt += `**Summary ${index + 1} (Level ${
          summary.summaryLevel
        }):**
${summary.summaryText}
**Key Topics**: ${relatedTopicsStr}
**Covers**: ${summary.messageRange?.messageCount || 0} messages

`;
      });

      systemPrompt += `These summaries represent the conversation history. The recent messages below continue from where these summaries end.`;
    } else {
      console.log("📚 [SUMMARIES] No summaries found to add to system prompt");
    }

    // Add topic inference guidance if we have related but not exact matches
    const smartContext = context.metadata?.smartContext as any;
    if (
      smartContext?.suggestRelatedTopics &&
      !smartContext?.hasExactMatches &&
      summaries &&
      summaries.length > 0
    ) {
      systemPrompt += `\n\n## TOPIC INFERENCE GUIDANCE
The user's query didn't find exact matches in our conversation history, but we found related topics that might be what they're referring to. 

**Related topics found**: ${summaries.map((s) => s.topicName).join(", ")}
**Search queries used**: ${smartContext.searchQueries?.join(", ") || "N/A"}

IMPORTANT: Instead of saying "no previous mentions found", acknowledge the related topics and ask for clarification. For example:
"I found some related discussions about [topic names]. Are you perhaps referring to our conversation about [specific topic]? If so, I can provide more details about that discussion."

This creates a more natural, human-like conversation flow where you help the user connect to the right topic.`;
    }

    // Enhance system prompt with intent analysis context and dynamic context usage guidance
    if (intentAnalysis) {
      systemPrompt += `\n\n## CURRENT CONVERSATION CONTEXT
**User Intent**: ${intentAnalysis.currentIntent}
**Contextual Relevance**: ${intentAnalysis.contextualRelevance}
**Relationship to History**: ${intentAnalysis.relationshipToHistory}
**Key Topics**: ${intentAnalysis.keyTopics.join(", ")}
**Compressed Context**: ${intentAnalysis.compressedContext}
${
  intentAnalysis.pendingQuestions.length > 0
    ? `**Pending Questions**: ${intentAnalysis.pendingQuestions.join(", ")}`
    : ""
}
${
  intentAnalysis.lastAssistantQuestion
    ? `**Last Assistant Question**: ${intentAnalysis.lastAssistantQuestion}`
    : ""
}

## CONFIDENCE ASSESSMENT
**Confidence Level**: ${intentAnalysis.confidenceLevel}
**Confidence Score**: ${(intentAnalysis.confidenceScore * 100).toFixed(1)}%
**Confidence Factors**:
- Search Result Quality: ${(intentAnalysis.confidenceFactors.searchResultQuality || 0.5 * 100).toFixed(1)}%
- Context Availability: ${(intentAnalysis.confidenceFactors.contextAvailability || 0.5 * 100).toFixed(1)}%
- Query Specificity: ${(intentAnalysis.confidenceFactors.querySpecificity || 0.5 * 100).toFixed(1)}%
- Historical Match: ${(intentAnalysis.confidenceFactors.historicalMatch || 0.5 * 100).toFixed(1)}%

${this.getConfidenceGuidance(intentAnalysis)}

## CONTEXT USAGE GUIDANCE FOR THIS QUERY
**Strategy**: ${intentAnalysis.contextRetrievalStrategy}
**Needs Historical Context**: ${intentAnalysis.needsHistoricalContext}

${this.getContextUsageGuidance(intentAnalysis)}

Use this context to provide more relevant and focused responses that align with the user's current intent and conversation flow.`;
    }

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Debug: Log the actual system prompt to verify summary inclusion
    console.log("🔍 [DEBUG] System prompt content check:", {
      systemPromptLength: systemPrompt.length,
      includesSummarySection: systemPrompt.includes(
        "## CONVERSATION HISTORY SUMMARIES"
      ),
      includesSummaryText: systemPrompt.includes("Summary 1"),
      fullSystemPrompt: systemPrompt, // Show complete system prompt
    });

    // Add conversation history (limit to maxConversationHistory)
    // These are only the recent, non-summarized messages
    const recentMessages = context.messageHistory.slice(
      -this.config.maxConversationHistory
    );

    for (const msg of recentMessages) {
      messages.push({
        role: msg.role.toLowerCase(),
        content: msg.content,
      });
    }

    return messages;
  }

  private getConfidenceGuidance(intentAnalysis: IntentAnalysisResult): string {
    const confidenceLevel = intentAnalysis.confidenceLevel;
    const relationshipToHistory = intentAnalysis.relationshipToHistory;
    const confidenceScore = intentAnalysis.confidenceScore;
    const factors = intentAnalysis.confidenceFactors;
    
    // Get search result quality information
    const searchQuality = factors.searchResultQuality || 0.5; // Default to medium quality if undefined
    const hasStrongMatches = searchQuality >= 0.8;
    const hasGoodMatches = searchQuality >= 0.6;
    
    if (relationshipToHistory === "recall") {
      if (confidenceLevel === "high") {
        if (hasStrongMatches) {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence with STRONG search results (quality: ${(searchQuality * 100).toFixed(0)}%). When presenting information from tools, be confident and direct. Use phrases like "I remember we discussed..." or "Yes, we talked about..." The search results are highly relevant and reliable.`;
        } else {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence but search results are moderate (quality: ${(searchQuality * 100).toFixed(0)}%). Present information confidently but acknowledge if results aren't perfect matches. Use "I believe we discussed..." or "Based on what I found..."`;
        }
      } else if (confidenceLevel === "medium") {
        if (hasGoodMatches) {
          return `**CONFIDENCE GUIDANCE**: You have MEDIUM confidence with good search results (quality: ${(searchQuality * 100).toFixed(0)}%). Present relevant findings with moderate confidence. Use "I found some information about..." or "This might be what you're referring to..." Be honest about uncertainty while still being helpful.`;
        } else {
          return `**CONFIDENCE GUIDANCE**: You have MEDIUM confidence with limited search results (quality: ${(searchQuality * 100).toFixed(0)}%). Be cautious about claiming certainty. Use "I found some potentially related information..." and ask for clarification to ensure accuracy.`;
        }
      } else {
        return `**CONFIDENCE GUIDANCE**: You have LOW confidence with weak search results (quality: ${(searchQuality * 100).toFixed(0)}%). Be very cautious about making claims. Use phrases like "I found some information that might be related..." or "Let me search more specifically..." Always ask for clarification and be transparent about limitations.`;
      }
    } else {
      // For non-recall queries, provide general confidence guidance
      if (confidenceLevel === "high") {
        if (hasStrongMatches) {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence with excellent context (quality: ${(searchQuality * 100).toFixed(0)}%). Present information clearly and directly. The available context is highly relevant and comprehensive.`;
        } else {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence with moderate context (quality: ${(searchQuality * 100).toFixed(0)}%). Present information clearly while noting any limitations in the available context.`;
        }
      } else if (confidenceLevel === "medium") {
        return `**CONFIDENCE GUIDANCE**: You have MEDIUM confidence with available context (quality: ${(searchQuality * 100).toFixed(0)}%). Present information while acknowledging any limitations or uncertainties. Be helpful but honest about what you can and cannot determine.`;
      } else {
        return `**CONFIDENCE GUIDANCE**: You have LOW confidence with limited context (quality: ${(searchQuality * 100).toFixed(0)}%). Be transparent about limitations and actively seek clarification or additional context through tools. Focus on asking good questions to better understand the user's needs.`;
      }
    }
  }

  private getContextUsageGuidance(intentAnalysis: IntentAnalysisResult): string {
    const strategy = intentAnalysis.contextRetrievalStrategy;
    const relationshipToHistory = intentAnalysis.relationshipToHistory;
    const searchQuality = intentAnalysis.confidenceFactors.searchResultQuality || 0.5;
    const confidenceLevel = intentAnalysis.confidenceLevel;
    
    // Add confidence indicator based on search quality
    const qualityIndicator = searchQuality >= 0.8 ? "🟢 High-quality context available" :
                           searchQuality >= 0.6 ? "🟡 Moderate-quality context available" :
                           "🔴 Limited context quality";
    
    const confidenceNote = confidenceLevel === "high" ? " (High confidence)" :
                          confidenceLevel === "medium" ? " (Medium confidence)" :
                          " (Low confidence - be cautious)";
    
    switch (strategy) {
      case "none":
        return `**Focus**: This appears to be a standalone query. You have minimal immediate context (last 1 turn). Use tools to search for any relevant background if needed. ${qualityIndicator}${confidenceNote}`;
      
      case "recent_only":
        return `**Focus**: This query relates to recent conversation. You have the last 1 turn available, but use tools to search for additional recent context if the user references anything beyond the immediate exchange. ${qualityIndicator}${confidenceNote}`;
      
      case "semantic_search":
        return `**Focus**: This query requires specific historical knowledge. Use the retrieved summaries and historical context from tools as your primary source. The minimal immediate context (last 1 turn) is just for conversational flow. ${qualityIndicator}${confidenceNote}`;
      
      case "date_based_search":
        return `**Focus**: This query is about specific time periods. Use the retrieved historical context from tools as your main source. The immediate context is minimal - rely on the date-based search results. ${qualityIndicator}${confidenceNote}`;
      
      case "all_available":
        return `**Focus**: This query requires comprehensive context. Use all available historical context from tools. Don't rely on the minimal immediate context - the tools provide the comprehensive information needed. ${qualityIndicator}${confidenceNote}`;
      
      default:
        // Fallback based on relationship to history
        if (relationshipToHistory === "recall") {
          return `**Focus**: This is a RECALL query - user is asking to remember/recall something from past conversation. ALWAYS use tools to search conversation history. Don't rely on minimal immediate context. ${qualityIndicator}${confidenceNote}`;
        } else if (relationshipToHistory === "continuation") {
          return `**Focus**: This appears to be a continuation. You have minimal immediate context (last 1 turn). Use tools to search for relevant context if the user references anything beyond the immediate exchange. ${qualityIndicator}${confidenceNote}`;
        } else if (relationshipToHistory === "new_topic") {
          return `**Focus**: This appears to be a new topic. Use tools to search for any relevant background context that might be helpful. ${qualityIndicator}${confidenceNote}`;
        } else if (relationshipToHistory === "clarification") {
          return `**Focus**: This appears to be a clarification request. Use tools to search for the context being clarified. Don't rely only on minimal immediate context. ${qualityIndicator}${confidenceNote}`;
        } else {
          return `**Focus**: You have minimal immediate context (last 1 turn). Use tools to search for relevant historical context as needed for this query. ${qualityIndicator}${confidenceNote}`;
        }
    }
  }

  private async loadSmartConversationContext(
    conversationId: string,
    intentAnalysis: IntentAnalysisResult,
    userId?: string
  ): Promise<{ context: ConversationContext; updatedIntentAnalysis: IntentAnalysisResult }> {
    try {
      // Reduced to 1 turn (2 messages) to force tool usage for better recall
      // This provides minimal immediate context to encourage using tools for historical context
      let recentMessageLimit = 2; // Minimum: last 1 turn (reduced from 3 turns)
      
      // Adjust based on context retrieval strategy
      switch (intentAnalysis.contextRetrievalStrategy) {
        case "none":
          recentMessageLimit = 2; // Only last 1 turn for immediate context
          break;
        case "recent_only":
          recentMessageLimit = 2; // Last 1 turn
          break;
        case "semantic_search":
        case "date_based_search":
        case "all_available":
          // For these strategies, we want more recent context plus summaries
          recentMessageLimit = Math.min(10, this.config.maxConversationHistory); // Up to 5 turns or config limit
          break;
      }

      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          // Dynamically load recent messages based on intent analysis
          messages: {
            orderBy: { createdAt: "desc" },
            take: recentMessageLimit,
            include: {
              toolUsages: true,
            },
          },
        },
      });

      if (!conversation) {
        console.warn(
          `Conversation with ID ${conversationId} not found, returning empty context`
        );
        return {
          context: {
            conversationId,
            userId: userId || "anonymous",
            messageHistory: [],
            metadata: {},
          },
          updatedIntentAnalysis: intentAnalysis,
        };
      }

      // Transform recent messages (reverse order since we got them desc)
      const messageHistory: MessageContext[] = conversation.messages
        .reverse() // Reverse to get chronological order (oldest first)
        .map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.createdAt,
          toolUsages: msg.toolUsages.map((usage) => ({
            toolName: usage.toolName,
            input: usage.input as any,
            output: usage.output as any,
            success: usage.status === "COMPLETED",
            duration: usage.duration || 0,
            error: usage.error || undefined,
          })),
          isSummary: false,
        }));

      // Use smart context retrieval based on intent analysis
      const smartContextResult = await this.smartContextService.retrieveContext(
        conversationId,
        intentAnalysis
      );

      // Update confidence scores based on actual search results
      const updatedIntentAnalysis = this.intentAnalysisService.updateConfidenceWithSearchResults(
        intentAnalysis,
        smartContextResult
      );

      console.log(`🧠 [SMART CONTEXT] Retrieved context:`, {
        conversationId,
        strategy: smartContextResult.retrievalMethod,
        totalAvailable: smartContextResult.totalAvailable,
        retrieved: smartContextResult.retrieved,
        needsHistoricalContext: updatedIntentAnalysis.needsHistoricalContext,
        keyTopics: updatedIntentAnalysis.keyTopics,
        confidence: {
          level: updatedIntentAnalysis.confidenceLevel,
          score: updatedIntentAnalysis.confidenceScore.toFixed(2),
          factors: updatedIntentAnalysis.confidenceFactors,
        },
      });

      return {
        context: {
          conversationId,
          userId: conversation.userId || "anonymous",
          messageHistory,
          metadata: {
            summaries: smartContextResult.summaries,
            contextStrategy: smartContextResult.retrievalMethod,
            contextStats: {
              totalAvailable: smartContextResult.totalAvailable,
              retrieved: smartContextResult.retrieved,
            },
            smartContext: smartContextResult.metadata,
          },
        },
        updatedIntentAnalysis,
      };
    } catch (error) {
      console.error("Error loading smart conversation context:", error);
      throw new Error("Failed to load smart conversation context");
    }
  }

  private async loadConversationContext(
    conversationId: string,
    userId?: string
  ): Promise<ConversationContext> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          // Always get the last 6 messages (3 turns) regardless of summary status
          messages: {
            orderBy: { createdAt: "desc" },
            take: 6, // Last 3 turns (USER + ASSISTANT pairs)
            include: {
              toolUsages: true,
            },
          },
        },
      });

      // Load summaries separately since they're not directly related to conversation
      const conversationSummaries =
        await this.prisma.conversationSummary.findMany({
          where: { conversationId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            summaryText: true,
            topicName: true,
            relatedTopics: true,
            messageRange: true,
            summaryLevel: true,
            topicRelevance: true,
            batchId: true,
            createdAt: true,
          },
        });

      if (!conversation) {
        // If conversation doesn't exist, return empty context instead of creating a new one
        // This prevents duplicate conversation creation while allowing the flow to continue
        console.warn(
          `Conversation with ID ${conversationId} not found, returning empty context`
        );
        return {
          conversationId,
          userId: userId || "anonymous",
          messageHistory: [],
          metadata: {},
        };
      }

      // Transform the last 3 turns of messages (reverse order since we got them desc)
      const messageHistory: MessageContext[] = conversation.messages
        .reverse() // Reverse to get chronological order (oldest first)
        .map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.createdAt,
          toolUsages: msg.toolUsages.map((usage) => ({
            toolName: usage.toolName,
            input: usage.input as any,
            output: usage.output as any,
            success: usage.status === "COMPLETED",
            duration: usage.duration || 0,
            error: usage.error || undefined,
          })),
          isSummary: false,
        }));

      // Add summaries to metadata for use in system prompt
      const summaries = conversationSummaries.map((summary: any) => ({
        id: summary.id,
        summaryText: summary.summaryText,
        topicName: summary.topicName,
        relatedTopics: summary.relatedTopics as string[],
        messageRange: summary.messageRange as any,
        summaryLevel: summary.summaryLevel,
        topicRelevance: summary.topicRelevance,
        batchId: summary.batchId,
        createdAt: summary.createdAt,
      }));

      console.log(`📚 [CONTEXT] Loaded conversation context:`, {
        conversationId,
        summariesCount: summaries.length,
        last3TurnsMessagesCount: messageHistory.length,
        totalContextReduction: summaries.reduce(
          (acc: number, s: any) =>
            acc + (s.messageRange as any)?.messageCount || 0,
          0
        ),
      });

      return {
        conversationId,
        userId: conversation.userId || "anonymous",
        messageHistory,
        metadata: {
          summaries, // Include summaries in metadata for system prompt
        },
      };
    } catch (error) {
      console.error("Error loading conversation context:", error);
      throw new Error("Failed to load conversation context");
    }
  }

  private async createNewConversation(userId?: string): Promise<string> {
    const conversation = await this.prisma.conversation.create({
      data: {
        title: "New Conversation",
        userId: userId || "anonymous",
      },
    });
    return conversation.id;
  }

  private async persistConversation(
    context: ConversationContext,
    savedUserMessageId: string,
    assistantMessage: MessageContext,
    toolsUsed: ToolUsageContext[],
    costCalculation?: {
      inputCost: number;
      outputCost: number;
      totalCost: number;
      inputTokens: number;
      outputTokens: number;
      webSearchCalls?: number;
      webSearchCost?: number;
    }
  ): Promise<void> {
    try {
      // User message already saved for intent analysis

      // Save assistant message with cost/token data
      const savedAssistantMessage = await this.prisma.message.create({
        data: {
          conversationId: context.conversationId!,
          role: assistantMessage.role,
          content: assistantMessage.content,
          inputTokens: costCalculation?.inputTokens || null,
          outputTokens: costCalculation?.outputTokens || null,
          cost: costCalculation?.totalCost || null,
        },
      });

      // Save tool usages
      if (toolsUsed.length > 0) {
        await this.prisma.toolUsage.createMany({
          data: toolsUsed.map((tool) => ({
            messageId: savedAssistantMessage.id,
            toolName: tool.toolName,
            input: tool.input,
            output: tool.output,
            status: tool.success ? "COMPLETED" : "FAILED",
            error: tool.error || null,
            duration: tool.duration || null,
          })),
        });
      }

      // Update conversation with aggregated cost/token data
      if (costCalculation) {
        const currentConversation = await this.prisma.conversation.findUnique({
          where: { id: context.conversationId! },
          select: {
            totalInputTokens: true,
            totalOutputTokens: true,
            totalCost: true,
          },
        });

        await this.prisma.conversation.update({
          where: { id: context.conversationId! },
          data: {
            updatedAt: new Date(),
            totalInputTokens:
              (currentConversation?.totalInputTokens || 0) +
              costCalculation.inputTokens,
            totalOutputTokens:
              (currentConversation?.totalOutputTokens || 0) +
              costCalculation.outputTokens,
            totalCost:
              (currentConversation?.totalCost || 0) + costCalculation.totalCost,
          },
        });
      } else {
        await this.prisma.conversation.update({
          where: { id: context.conversationId! },
          data: { updatedAt: new Date() },
        });
      }
    } catch (error) {
      console.error("Error persisting conversation:", error);
      // Don't throw here to avoid breaking the response flow
    }
  }

  async getConversationHistory(
    conversationId: string
  ): Promise<ConversationContext | null> {
    try {
      return await this.loadConversationContext(conversationId);
    } catch (error) {
      console.error("Error getting conversation history:", error);
      return null;
    }
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      await this.prisma.conversation.delete({
        where: { id: conversationId },
      });
      return true;
    } catch (error) {
      console.error("Error deleting conversation:", error);
      return false;
    }
  }
}
