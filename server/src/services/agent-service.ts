import OpenAI from "openai";
import { PrismaClient, Role, UsageOperationType } from "@prisma/client";
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
import { UsageTrackingService } from "./usage-tracking-service";
import { ToolContextService } from "./tool-context-service";
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
  private usageTrackingService: UsageTrackingService;
  private toolContextService: ToolContextService;
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
    this.usageTrackingService = new UsageTrackingService(this.prisma);

    // Initialize SmartContextService with semantic, date-based, and web search tools
    const semanticSearchTool = this.toolRegistry.getTool(
      "semantic_topic_search"
    );
    const dateBasedSearchTool = this.toolRegistry.getTool(
      "date_based_topic_search"
    );
    const webSearchTool = this.toolRegistry.getTool("web_search");

    if (!semanticSearchTool) {
      throw new Error("SemanticTopicSearchTool not found in tool registry");
    }
    if (!dateBasedSearchTool) {
      throw new Error("DateBasedTopicSearchTool not found in tool registry");
    }
    if (!webSearchTool) {
      throw new Error("WebSearchTool not found in tool registry");
    }

    this.smartContextService = new SmartContextService(
      this.prisma,
      semanticSearchTool as any,
      dateBasedSearchTool as any,
      webSearchTool as any
    );

    this.toolContextService = new ToolContextService();

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
    return `## CORE IDENTITY
You are a conversational AI assistant with excellent memory and natural communication skills. You remember our conversations and can recall topics we've discussed, even from long ago, with more recent topics being easier to access.

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
- Be helpful, accurate, and maintain the flow of our ongoing conversation

## TOOL USAGE GUIDELINES
- Use tools proactively to gather information when helpful
- Combine tool results with immediate context for complete understanding
- If a tool result is not directly relevant, ask for clarification or try a different search term
- Don't assume tools will always find the exact information needed
- If a tool fails to provide useful information, don't hesitate to ask for help or try a different approach

## IMPORTANT NOTICE:
- The timestamp provided at the bottom of the summary topics are the time when the topic was last discussed in the conversation and not of the event that was discussed. That timestamp is an isolated information about the conversation between the user and the AI assistant and has nothing to do with the even or topic discussed. So if you see timestamps like this "'**Timestamp**: The conversation about this topic happened 0 days from today, that is on 28/09/2025 and 17:11'", treat them like isolated information and do not add it or relate it to the "Content" of the topic"
`;
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

    // Create a new conversation if no conversationId is provided
    if (!conversationId) {
      conversationId = await this.createNewConversation(request.userId);
      console.log("📝 [AGENT] Created new conversation:", { conversationId });
    } else {
      // Check if the provided conversation exists, create it if it doesn't
      const existingConversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!existingConversation) {
        console.log("📝 [AGENT] Conversation not found, creating:", {
          conversationId,
        });
        await this.prisma.conversation.create({
          data: {
            id: conversationId,
            title: "New Conversation",
            userId: request.userId || "anonymous",
          },
        });
        console.log("📝 [AGENT] Created conversation with provided ID:", {
          conversationId,
        });
      }
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
        request.message,
        request.userId
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
      const messages = this.prepareMessagesForOpenAI(
        context,
        updatedIntentAnalysis
      );

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

      const completionStartTime = Date.now();
      const completion = await this.openai.chat.completions.create(
        completionParams
      );
      const completionDuration = Date.now() - completionStartTime;

      console.log("✅ [AGENT] OpenAI API response received:", {
        model: completion.model,
        usage: completion.usage,
        finishReason: completion.choices[0]?.finish_reason,
        hasToolCalls: !!completion.choices[0]?.message?.tool_calls?.length,
        responseLength: completion.choices[0]?.message?.content?.length || 0,
      });

      // Track usage for main completion
      const usageData: any = {
        conversationId,
        messageId: savedUserMessage.id,
        operationType: UsageOperationType.AGENT_COMPLETION,
        operationSubtype: "main_completion",
        model: completion.model || model,
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
        duration: completionDuration,
        success: true,
        metadata: {
          finishReason: completion.choices[0]?.finish_reason,
          hasToolCalls: !!completion.choices[0]?.message?.tool_calls?.length,
        },
      };
      if (request.userId) usageData.userId = request.userId;
      await this.usageTrackingService.trackUsage(usageData);

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

        // Process tool results with enhanced context
        const contextualizedToolResults =
          await this.processToolResultsWithContext(
            toolResults,
            request.message,
            updatedIntentAnalysis,
            assistantMessage.tool_calls
          );

        // Create follow-up completion with enhanced tool results
        const toolMessages = [
          ...messages,
          {
            role: "assistant" as const,
            content: assistantMessage.content,
            tool_calls: assistantMessage.tool_calls,
          },
          ...contextualizedToolResults,
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

        const followUpStartTime = Date.now();
        followUpCompletion = await this.openai.chat.completions.create(
          followUpParams
        );
        const followUpDuration = Date.now() - followUpStartTime;

        console.log("✅ [AGENT] Follow-up API response received:", {
          usage: followUpCompletion.usage,
          finishReason: followUpCompletion.choices[0]?.finish_reason,
          responseLength:
            followUpCompletion.choices[0]?.message?.content?.length || 0,
        });

        // Track usage for follow-up completion
        const followUpUsageData: any = {
          conversationId,
          messageId: savedUserMessage.id,
          operationType: UsageOperationType.AGENT_COMPLETION,
          operationSubtype: "tool_followup_completion",
          model: followUpCompletion.model || model,
          inputTokens: followUpCompletion.usage?.prompt_tokens || 0,
          outputTokens: followUpCompletion.usage?.completion_tokens || 0,
          duration: followUpDuration,
          success: true,
          metadata: {
            finishReason: followUpCompletion.choices[0]?.finish_reason,
            toolCount: toolResults.length,
            successfulTools: toolResults.filter((r) => r.success).length,
          },
        };
        if (request.userId) followUpUsageData.userId = request.userId;
        await this.usageTrackingService.trackUsage(followUpUsageData);

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

      // Generate human-like reasoning about actions taken
      const reasoning = this.generateReasoningExplanation(
        updatedIntentAnalysis,
        toolsUsed,
        context
      );

      return {
        message: finalContent,
        conversationId,
        toolsUsed,
        context,
        intentAnalysis: updatedIntentAnalysis,
        reasoning,
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

  /**
   * Process tool results with rich context and explanations
   * Enhanced to handle multi-tool execution with intelligent synthesis
   */
  private async processToolResultsWithContext(
    toolResults: ToolUsageContext[],
    userQuery: string,
    intentAnalysis: IntentAnalysisResult,
    toolCalls: any[]
  ): Promise<any[]> {
    const contextualizedResults = [];

    // Check if this is a multi-tool execution from smart context service
    const isMultiToolExecution =
      toolResults.length > 1 ||
      (toolResults.length === 1 &&
        intentAnalysis.toolExecutionPlan?.length > 1);

    if (isMultiToolExecution) {
      // Handle multi-tool execution with intelligent synthesis
      return this.processMultiToolResults(
        toolResults,
        userQuery,
        intentAnalysis,
        toolCalls
      );
    }

    // Legacy single-tool processing
    for (let i = 0; i < toolResults.length; i++) {
      const result = toolResults[i];
      const toolCall = toolCalls[i];
      const toolCallId = toolCall?.id || `tool_${i}`;

      if (!result) continue;

      if (result.success) {
        // Create mock reasoning for now - in a real implementation, this would come from the tool selection process
        const mockReasoning = {
          intentAnalysis: {
            userIntent: intentAnalysis.currentIntent,
            keyTopics: intentAnalysis.keyTopics,
            temporalReferences: intentAnalysis.dateQuery
              ? [intentAnalysis.dateQuery]
              : [],
            needsHistoricalContext:
              intentAnalysis.contextRetrievalStrategy !== "none",
          },
          toolSelection: {
            selectedTool: result.toolName,
            reason: `Selected ${
              result.toolName
            } to address user's query about ${intentAnalysis.keyTopics.join(
              ", "
            )}`,
            alternativeTools: [],
            confidence: intentAnalysis.confidenceScore,
          },
          searchStrategy: {
            strategy: intentAnalysis.contextRetrievalStrategy,
            queries: intentAnalysis.keyTopics,
            parameters: result.input,
            expectedResults: `Relevant information about ${intentAnalysis.keyTopics.join(
              ", "
            )}`,
          },
        };

        const metadata = {
          executionTime: result.duration,
          success: result.success,
          resultCount: Array.isArray(result.output?.data)
            ? result.output.data.length
            : 1,
          confidence: intentAnalysis.confidenceScore,
        };

        const contextualizedResult =
          this.toolContextService.createContextualizedResult(
            result.toolName,
            userQuery,
            intentAnalysis,
            result.output,
            metadata,
            mockReasoning
          );

        // Create actionable tool message instead of complex JSON
        const timeframe = this.extractTimeframe(result.toolName, result.output);
        const results = {
          summary: this.generateResultsSummary(result.toolName, result.output),
          action: this.generateActionInstructions(
            result.toolName,
            result.output,
            intentAnalysis
          ),
          relevance: this.calculateRelevance(
            result.toolName,
            result.output,
            intentAnalysis
          ),
          ...(timeframe && { timeframe }),
        };

        const actionableMessage = this.createActionableToolMessage({
          userRequest: userQuery,
          toolExecution: {
            name: result.toolName,
            reason: this.generateExecutionReason(
              result.toolName,
              intentAnalysis
            ),
            timestamp: new Date().toISOString(),
          },
          results,
          data: result.output,
          confidence: intentAnalysis.confidenceScore || 0.8,
        });

        contextualizedResults.push({
          role: "tool" as const,
          tool_call_id: toolCallId,
          content: actionableMessage,
        });
      } else {
        // For failed tools, provide clear error context
        const errorMessage = this.createActionableToolMessage({
          userRequest: userQuery,
          toolExecution: {
            name: result.toolName,
            reason: this.generateExecutionReason(
              result.toolName,
              intentAnalysis
            ),
            timestamp: new Date().toISOString(),
          },
          results: {
            summary: `Tool execution failed: ${result.error}`,
            action:
              "Let the user know the tool failed and suggest alternative approaches or rephrasing their request.",
            relevance: "ERROR - tool execution failed",
          },
          data: { success: false, error: result.error },
          confidence: 0,
        });

        contextualizedResults.push({
          role: "tool" as const,
          tool_call_id: toolCallId,
          content: errorMessage,
        });
      }
    }

    return contextualizedResults;
  }

  /**
   * Process multi-tool execution results with intelligent synthesis and prioritization
   */
  private async processMultiToolResults(
    toolResults: ToolUsageContext[],
    userQuery: string,
    intentAnalysis: IntentAnalysisResult,
    toolCalls: any[]
  ): Promise<any[]> {
    const contextualizedResults = [];
    const successfulResults = toolResults.filter((r) => r.success);
    const failedResults = toolResults.filter((r) => !r.success);

    // Categorize tools by priority and type
    const toolsByPriority = this.categorizeToolsByPriority(
      toolResults,
      intentAnalysis
    );
    const criticalToolsFailed = toolsByPriority.critical.some(
      (t) => !t.success
    );

    console.log(
      `🔄 [MULTI-TOOL] Processing ${toolResults.length} tool results:`,
      {
        successful: successfulResults.length,
        failed: failedResults.length,
        criticalFailed: criticalToolsFailed,
        queryType: intentAnalysis.queryType,
        strategy: intentAnalysis.executionStrategy,
      }
    );

    // Create synthesized result message
    const synthesizedMessage = this.createSynthesizedToolMessage({
      userRequest: userQuery,
      intentAnalysis,
      toolResults,
      successfulResults,
      failedResults,
      toolsByPriority,
      criticalToolsFailed,
    });

    // Create individual tool results for each tool call - REQUIRED by OpenAI API
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const result = toolResults[i];

      if (!toolCall?.id) {
        console.warn(`⚠️ [TOOL-CALL] Missing tool call ID for index ${i}`);
        continue;
      }

      let content: string;

      if (result && result.success) {
        // Use detailed message for successful results
        content = this.createDetailedToolMessage(
          result,
          userQuery,
          intentAnalysis
        );
      } else if (result && !result.success) {
        // Create error message for failed results
        content = `Tool execution failed: ${
          result.error || "Unknown error"
        }. Tool: ${result.toolName || "unknown"}`;
      } else {
        // Fallback for missing results
        content = `Tool execution completed but no result data available for ${
          toolCall.function?.name || "unknown tool"
        }.`;
      }

      contextualizedResults.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: content,
      });
    }

    // Add synthesized summary as additional context if multiple tools were used
    if (
      toolCalls.length > 1 &&
      successfulResults.length > 0 &&
      contextualizedResults.length > 0
    ) {
      // Create a summary message using the first tool call ID (since we need to respond to all calls)
      // This provides the synthesized overview while maintaining API compliance
      const firstResult = contextualizedResults[0];
      if (firstResult) {
        firstResult.content = synthesizedMessage + "\n\n" + firstResult.content;
      }
    }

    return contextualizedResults;
  }

  /**
   * Categorize tools by priority based on execution plan
   */
  private categorizeToolsByPriority(
    toolResults: ToolUsageContext[],
    intentAnalysis: IntentAnalysisResult
  ): {
    critical: ToolUsageContext[];
    high: ToolUsageContext[];
    medium: ToolUsageContext[];
    low: ToolUsageContext[];
  } {
    const categories = {
      critical: [] as ToolUsageContext[],
      high: [] as ToolUsageContext[],
      medium: [] as ToolUsageContext[],
      low: [] as ToolUsageContext[],
    };

    for (const result of toolResults) {
      // Find the corresponding tool plan to get priority
      const toolPlan = intentAnalysis.toolExecutionPlan?.find(
        (plan) => plan.toolName === result.toolName
      );

      const priority = toolPlan?.priority || "medium";
      categories[priority].push(result);
    }

    return categories;
  }

  /**
   * Create synthesized message from multiple tool results
   */
  private createSynthesizedToolMessage(context: {
    userRequest: string;
    intentAnalysis: IntentAnalysisResult;
    toolResults: ToolUsageContext[];
    successfulResults: ToolUsageContext[];
    failedResults: ToolUsageContext[];
    toolsByPriority: {
      critical: ToolUsageContext[];
      high: ToolUsageContext[];
      medium: ToolUsageContext[];
      low: ToolUsageContext[];
    };
    criticalToolsFailed: boolean;
  }): string {
    const {
      userRequest,
      intentAnalysis,
      toolResults,
      successfulResults,
      failedResults,
      toolsByPriority,
      criticalToolsFailed,
    } = context;

    let message = `🎯 MULTI-TOOL EXECUTION RESULTS\n`;
    message += `Query: "${userRequest}"\n`;
    message += `Strategy: ${intentAnalysis.executionStrategy} execution\n`;
    message += `Query Type: ${intentAnalysis.queryType}\n`;
    message += `Tools Executed: ${toolResults.length} (${successfulResults.length} successful, ${failedResults.length} failed)\n\n`;

    // Handle critical tool failures
    if (criticalToolsFailed) {
      message += `⚠️ CRITICAL TOOL FAILURE DETECTED\n`;
      const failedCritical = toolsByPriority.critical.filter((t) => !t.success);
      message += `Failed Critical Tools: ${failedCritical
        .map((t) => t.toolName)
        .join(", ")}\n`;
      message += `INSTRUCTION: Inform the user that some essential information could not be retrieved. `;
      message += `Provide what information is available from successful tools and suggest alternative approaches.\n\n`;
    }

    // Synthesize successful results by priority
    if (successfulResults.length > 0) {
      message += `✅ SYNTHESIZED RESULTS - USE ALL INFORMATION BELOW\n\n`;

      // Process critical results first
      if (toolsByPriority.critical.some((t) => t.success)) {
        message += `🔴 CRITICAL INFORMATION:\n`;
        const successfulCritical = toolsByPriority.critical.filter(
          (t) => t.success
        );
        for (const result of successfulCritical) {
          message += this.formatToolResultForSynthesis(result, "critical");
        }
        message += `\n`;
      }

      // Process high priority results
      if (toolsByPriority.high.some((t) => t.success)) {
        message += `🟠 HIGH PRIORITY INFORMATION:\n`;
        const successfulHigh = toolsByPriority.high.filter((t) => t.success);
        for (const result of successfulHigh) {
          message += this.formatToolResultForSynthesis(result, "high");
        }
        message += `\n`;
      }

      // Process medium and low priority results
      const otherSuccessful = [
        ...toolsByPriority.medium.filter((t) => t.success),
        ...toolsByPriority.low.filter((t) => t.success),
      ];

      if (otherSuccessful.length > 0) {
        message += `🟡 ADDITIONAL INFORMATION:\n`;
        for (const result of otherSuccessful) {
          message += this.formatToolResultForSynthesis(result, "additional");
        }
        message += `\n`;
      }

      // Provide synthesis instructions
      message += `📋 SYNTHESIS INSTRUCTIONS:\n`;
      message += this.generateSynthesisInstructions(
        intentAnalysis,
        successfulResults
      );
    }

    // Handle complete failure
    if (successfulResults.length === 0) {
      message += `❌ ALL TOOLS FAILED\n`;
      message += `INSTRUCTION: Inform the user that the requested information could not be retrieved. `;
      message += `Suggest alternative approaches or rephrasing their request.\n\n`;

      message += `Failed Tools:\n`;
      for (const result of failedResults) {
        message += `- ${result.toolName}: ${result.error}\n`;
      }
    }

    return message;
  }

  /**
   * Format individual tool result for synthesis
   */
  private formatToolResultForSynthesis(
    result: ToolUsageContext,
    priority: string
  ): string {
    let formatted = `• ${result.toolName.toUpperCase()}:\n`;

    const resultCount = this.getResultCount(result.output);
    formatted += `  Found: ${resultCount} result${
      resultCount === 1 ? "" : "s"
    }\n`;

    const timeframe = this.extractTimeframe(result.toolName, result.output);
    if (timeframe) {
      formatted += `  Timeframe: ${timeframe}\n`;
    }

    const summary = this.generateResultsSummary(result.toolName, result.output);
    formatted += `  Summary: ${summary}\n`;

    // Include actual data for AI to reference
    formatted += `  Data: ${JSON.stringify(result.output, null, 2)}\n\n`;

    return formatted;
  }

  /**
   * Generate synthesis instructions based on query type and results
   */
  private generateSynthesisInstructions(
    intentAnalysis: IntentAnalysisResult,
    successfulResults: ToolUsageContext[]
  ): string {
    let instructions = "";

    switch (intentAnalysis.queryType) {
      case "hybrid_temporal_current":
        instructions = `Combine historical conversation data with current web information. `;
        instructions += `Present a comprehensive answer that shows both past context and current updates. `;
        instructions += `Clearly distinguish between historical and current information.`;
        break;

      case "hybrid_topic_current":
        instructions = `Merge conversation history about the topic with current information. `;
        instructions += `Provide a complete picture that builds on past discussions and adds new insights.`;
        break;

      case "comprehensive":
        instructions = `Synthesize all available information sources to provide the most complete answer possible. `;
        instructions += `Prioritize critical information and organize by relevance to the user's query.`;
        break;

      case "temporal_only":
        instructions = `Focus on the temporal/historical aspects. Use conversation history and date-based searches `;
        instructions += `to provide context about past events or discussions.`;
        break;

      case "current_only":
        instructions = `Provide current, up-to-date information. Use web search results and current data `;
        instructions += `to answer the user's question with the latest information available.`;
        break;

      default:
        instructions = `Combine all available information to provide a comprehensive answer. `;
        instructions += `Prioritize the most relevant and reliable sources.`;
    }

    instructions += `\n\nKey Topics: ${intentAnalysis.keyTopics.join(", ")}\n`;
    instructions += `Available Sources: ${successfulResults
      .map((r) => r.toolName)
      .join(", ")}\n`;

    return instructions;
  }

  /**
   * Create detailed tool message for individual tool results (debugging)
   */
  private createDetailedToolMessage(
    result: ToolUsageContext,
    userQuery: string,
    intentAnalysis: IntentAnalysisResult
  ): string {
    let message = `🔧 DETAILED TOOL RESULT\n`;
    message += `Tool: ${result.toolName}\n`;
    message += `Success: ${result.success}\n`;
    message += `Duration: ${result.duration}ms\n`;

    if (result.success) {
      const resultCount = this.getResultCount(result.output);
      message += `Results Found: ${resultCount}\n`;

      const timeframe = this.extractTimeframe(result.toolName, result.output);
      if (timeframe) {
        message += `Timeframe: ${timeframe}\n`;
      }

      message += `\nData:\n${JSON.stringify(result.output, null, 2)}`;
    } else {
      message += `Error: ${result.error}\n`;
    }

    return message;
  }

  /**
   * Creates actionable tool message for AI consumption
   */
  private createActionableToolMessage(context: {
    userRequest: string;
    toolExecution: {
      name: string;
      reason: string;
      timestamp: string;
    };
    results: {
      summary: string;
      action: string;
      relevance: string;
      timeframe?: string;
    };
    data: any;
    confidence: number;
  }): string {
    // Create clear, direct instructions based on tool type and results
    const resultCount = this.getResultCount(context.data);

    if (resultCount === 0) {
      return `❌ NO RESULTS FOUND
Tool: ${context.toolExecution.name}
Query: "${context.userRequest}"

INSTRUCTION: Tell the user no matching information was found and suggest alternative approaches.`;
    }

    // For successful results, be very explicit about what to do
    let instruction: string;

    // Handle different tool types with specific instructions
    switch (context.toolExecution.name) {
      case "semantic_topic_search":
      case "date_based_topic_search":
        instruction = `✅ SEARCH RESULTS FOUND - USE THESE TO ANSWER THE USER'S QUESTION
Found ${resultCount} relevant result${resultCount === 1 ? "" : "s"} for: "${
          context.userRequest
        }"
${context.results.timeframe ? `Timeframe: ${context.results.timeframe}` : ""}

CRITICAL: The user asked about past conversations. These search results ARE the information they're looking for. Reference the specific topics, details, and information found below to answer their question completely.`;
        break;

      case "web_search":
        instruction = `✅ WEB SEARCH RESULTS FOUND - USE THESE FOR CURRENT INFORMATION
Found ${resultCount} web result${resultCount === 1 ? "" : "s"} for: "${
          context.userRequest
        }"

CRITICAL: These are current web search results. Use them to provide up-to-date information and cite the sources. Combine with conversation context if relevant.`;
        break;

      case "topic_count_tool":
        instruction = `✅ CONVERSATION STATISTICS FOUND - USE THIS COUNT DATA
Query: "${context.userRequest}"
Results: ${context.results.summary}

CRITICAL: Provide the user with the specific count/statistics found below. This is factual data about their conversation history.`;
        break;

      case "current_time_tool":
        instruction = `✅ CURRENT TIME DATA - USE THIS INFORMATION
Query: "${context.userRequest}"
Results: ${context.results.summary}

INSTRUCTION: Use the current time/date information below to answer the user's time-related question.`;
        break;

      default:
        // Fallback for any new tools
        instruction = `✅ TOOL RESULTS - USE THIS INFORMATION
Tool: ${context.toolExecution.name}
Results: ${context.results.summary}

INSTRUCTION: ${context.results.action}`;
    }

    return `${instruction}

📋 DATA TO REFERENCE:
${JSON.stringify(context.data, null, 2)}`;
  }

  /**
   * Generates execution reason based on tool and intent
   */
  private generateExecutionReason(
    toolName: string,
    intentAnalysis: IntentAnalysisResult
  ): string {
    const reasonMap: Record<string, string> = {
      date_based_topic_search: `User asked about ${
        intentAnalysis.dateQuery || "date-specific content"
      } - executed date-based search`,
      semantic_topic_search: `User asked about specific topics: ${intentAnalysis.keyTopics.join(
        ", "
      )} - executed semantic search`,
      web_search: `User query requires current information not available in conversation history - executed web search`,
      topic_count_tool: `User requested count/statistics about conversation topics`,
      current_time_tool: `User requested current time/date information`,
      conversation_summary_tool: `User requested conversation summary or overview`,
    };

    return (
      reasonMap[toolName] ||
      `Executed ${toolName} to address user's query about ${intentAnalysis.keyTopics.join(
        ", "
      )}`
    );
  }

  /**
   * Generates clear results summary from tool output
   */
  private generateResultsSummary(toolName: string, output: any): string {
    if (!output?.data) return "No results found";

    const data = output.data;

    // Handle date-based topic search
    if (toolName === "date_based_topic_search") {
      const topics = data.topics || [];
      const totalFound = data.totalFound || topics.length;
      const hasMore = data.hasMoreTopics;

      let summary = `Found ${totalFound} topic${totalFound === 1 ? "" : "s"}`;
      if (data.parsedTime?.startDate) {
        const startDate = new Date(
          data.parsedTime.startDate
        ).toLocaleDateString();
        const endDate = new Date(data.parsedTime.endDate).toLocaleDateString();
        summary += ` from ${
          startDate === endDate ? startDate : `${startDate} to ${endDate}`
        }`;
      }
      if (hasMore) {
        summary += ` (showing top ${topics.length})`;
      }
      return summary;
    }

    // Handle semantic topic search
    if (toolName === "semantic_topic_search") {
      const results = data.results || [];
      return `Found ${results.length} semantically related topic${
        results.length === 1 ? "" : "s"
      }`;
    }

    // Handle web search
    if (toolName === "web_search") {
      const results = data.results || data.webResults || [];
      const count = Array.isArray(results) ? results.length : 0;
      return `Found ${count} web search result${count === 1 ? "" : "s"}`;
    }

    // Handle topic count
    if (toolName === "topic_count_tool") {
      const count = data.count || 0;
      return `Found ${count} total topics in conversation`;
    }

    // Handle current time
    if (toolName === "current_time_tool") {
      const currentTime = data.currentTime || data.timestamp || "current time";
      return `Retrieved current time: ${currentTime}`;
    }

    // Generic fallback
    const count = Array.isArray(data)
      ? data.length
      : data.results?.length || data.topics?.length || 1;
    return `Found ${count} result${count === 1 ? "" : "s"}`;
  }

  /**
   * Generates specific action instructions based on tool results
   */
  private generateActionInstructions(
    toolName: string,
    output: any,
    intentAnalysis: IntentAnalysisResult
  ): string {
    const count = this.getResultCount(output);

    switch (toolName) {
      case "semantic_topic_search":
      case "date_based_topic_search":
        if (count === 0) {
          return "No matching conversation results found. Let the user know and suggest alternative approaches or different search terms.";
        }

        let instructions = `USE THESE ${count} CONVERSATION RESULT${
          count === 1 ? "" : "S"
        } to answer the user's question comprehensively.`;

        // Add specific guidance based on intent
        if (intentAnalysis.relationshipToHistory === "recall") {
          instructions +=
            " Reference specific topics, dates, and details mentioned in the results to help the user recall the conversation.";
        } else if (intentAnalysis.dateQuery) {
          instructions +=
            " Reference the specific timeframes and dates found in the results.";
        } else {
          instructions += " Reference the relevant topics and context found.";
        }
        return instructions;

      case "web_search":
        if (count === 0) {
          return "No web search results found. Let the user know and suggest alternative search terms or approaches.";
        }
        return `USE THESE ${count} WEB SEARCH RESULT${
          count === 1 ? "" : "S"
        } to provide current information. Always cite your sources and combine with conversation context when relevant.`;

      case "topic_count_tool":
        return "Provide the user with the specific topic count and any relevant statistics about their conversation history.";

      case "current_time_tool":
        return "Use the current time/date information to answer the user's time-related question accurately.";

      default:
        return "Use this information to respond to the user's request appropriately.";
    }
  }

  /**
   * Calculates relevance level based on results and intent
   */
  private calculateRelevance(
    toolName: string,
    output: any,
    intentAnalysis: IntentAnalysisResult
  ): string {
    const count = this.getResultCount(output);

    if (count === 0) return "NO RESULTS";

    // High relevance for exact date matches
    if (
      toolName === "date_based_topic_search" &&
      output?.data?.topics?.some((t: any) => t.timeMatch === "exact")
    ) {
      return "HIGH - exact date match";
    }

    // High relevance for good semantic matches
    if (toolName === "semantic_topic_search" && count >= 3) {
      return "HIGH - multiple relevant topics found";
    }

    // Medium relevance for partial matches
    if (count >= 1) {
      return "MEDIUM - relevant content found";
    }

    return "LOW - limited results";
  }

  /**
   * Extracts timeframe information from tool output
   */
  private extractTimeframe(toolName: string, output: any): string | undefined {
    if (toolName === "date_based_topic_search" && output?.data?.parsedTime) {
      const { startDate, endDate } = output.data.parsedTime;
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (start.toDateString() === end.toDateString()) {
          return `${start.toLocaleDateString()} (${start.toLocaleTimeString()} - ${end.toLocaleTimeString()})`;
        } else {
          return `${start.toLocaleDateString()} to ${end.toLocaleDateString()}`;
        }
      }
    }
    return undefined;
  }

  /**
   * Helper to get result count from various tool output formats
   */
  private getResultCount(output: any): number {
    if (!output?.data) return 0;

    const data = output.data;
    return (
      data.topics?.length ||
      data.results?.length ||
      data.count ||
      (Array.isArray(data) ? data.length : 1)
    );
  }

  private async executeToolCalls(
    toolCalls: any[],
    conversationId?: string,
    messageId?: string,
    userId?: string
  ): Promise<ToolUsageContext[]> {
    const results: ToolUsageContext[] = [];

    for (const toolCall of toolCalls) {
      const startTime = Date.now();

      try {
        const toolName = toolCall.function.name;
        const toolInput = JSON.parse(toolCall.function.arguments);

        const result = await this.toolRegistry.executeTool(toolName, toolInput);
        const duration = Date.now() - startTime;

        results.push({
          toolName,
          input: toolInput,
          output: result.success ? result : { error: result.error },
          success: result.success,
          duration,
          ...(result.success ? {} : { error: result.error }),
        });

        // Track tool usage
        if (conversationId && messageId) {
          const toolUsageData: any = {
            conversationId,
            messageId,
            operationType: UsageOperationType.TOOL_CALL,
            operationSubtype: toolName,
            model: "tool", // Tools don't use AI models
            inputTokens: 0,
            outputTokens: 0,
            duration,
            success: result.success,
            metadata: {
              toolName,
              inputSize: JSON.stringify(toolInput).length,
              outputSize: JSON.stringify(result).length,
              ...(result.success ? {} : { error: result.error }),
            },
          };
          if (userId) toolUsageData.userId = userId;
          if (!result.success) toolUsageData.errorMessage = result.error;

          await this.usageTrackingService.trackUsage(toolUsageData);
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        results.push({
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
          output: null,
          success: false,
          duration,
          error: errorMessage,
        });

        // Track failed tool usage
        if (conversationId && messageId) {
          const toolUsageData: any = {
            conversationId,
            messageId,
            operationType: UsageOperationType.TOOL_CALL,
            operationSubtype: toolCall.function.name,
            model: "tool",
            inputTokens: 0,
            outputTokens: 0,
            duration,
            success: false,
            errorMessage,
            metadata: {
              toolName: toolCall.function.name,
              inputSize: toolCall.function.arguments?.length || 0,
              error: errorMessage,
            },
          };
          if (userId) toolUsageData.userId = userId;

          await this.usageTrackingService.trackUsage(toolUsageData);
        }
      }
    }

    return results;
  }

  private prepareMessagesForOpenAI(
    context: ConversationContext,
    intentAnalysis?: IntentAnalysisResult
  ): any[] {
    // Use the new structured system prompt approach
    const structuredPrompt =
      this.toolContextService.buildStructuredSystemPrompt(
        this.config.systemPrompt,
        context,
        intentAnalysis
      );

    const systemPrompt =
      this.toolContextService.renderStructuredPrompt(structuredPrompt);

    // Debug logging for the new structured approach
    console.log("🔧 [STRUCTURED PROMPT] Generated system prompt:", {
      systemPromptLength: systemPrompt.length,
      sections: Object.keys(structuredPrompt).length,
      hasToolContext: !!structuredPrompt.toolContext,
      hasConversationContext: !!structuredPrompt.conversationContext,
      hasConfidenceAssessment: !!structuredPrompt.confidenceAssessment,
    });

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Add conversation history (limit to latest 2 turns = 4 messages max)
    // This ensures we only send the most recent context, forcing the AI to use tools for historical context
    const recentMessages = context.messageHistory.slice(-4); // Latest 2 turns (USER + ASSISTANT pairs)

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
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence with STRONG search results (quality: ${(
            searchQuality * 100
          ).toFixed(
            0
          )}%). When presenting information from tools, be confident and direct. Use phrases like "I remember we discussed..." or "Yes, we talked about..." The search results are highly relevant and reliable.`;
        } else {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence but search results are moderate (quality: ${(
            searchQuality * 100
          ).toFixed(
            0
          )}%). Present information confidently but acknowledge if results aren't perfect matches. Use "I believe we discussed..." or "Based on what I found..."`;
        }
      } else if (confidenceLevel === "medium") {
        if (hasGoodMatches) {
          return `**CONFIDENCE GUIDANCE**: You have MEDIUM confidence with good search results (quality: ${(
            searchQuality * 100
          ).toFixed(
            0
          )}%). Present relevant findings with moderate confidence. Use "I found some information about..." or "This might be what you're referring to..." Be honest about uncertainty while still being helpful.`;
        } else {
          return `**CONFIDENCE GUIDANCE**: You have MEDIUM confidence with limited search results (quality: ${(
            searchQuality * 100
          ).toFixed(
            0
          )}%). Be cautious about claiming certainty. Use "I found some potentially related information..." and ask for clarification to ensure accuracy.`;
        }
      } else {
        return `**CONFIDENCE GUIDANCE**: You have LOW confidence with weak search results (quality: ${(
          searchQuality * 100
        ).toFixed(
          0
        )}%). Be very cautious about making claims. Use phrases like "I found some information that might be related..." or "Let me search more specifically..." Always ask for clarification and be transparent about limitations.`;
      }
    } else {
      // For non-recall queries, provide general confidence guidance
      if (confidenceLevel === "high") {
        if (hasStrongMatches) {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence with excellent context (quality: ${(
            searchQuality * 100
          ).toFixed(
            0
          )}%). Present information clearly and directly. The available context is highly relevant and comprehensive.`;
        } else {
          return `**CONFIDENCE GUIDANCE**: You have HIGH confidence with moderate context (quality: ${(
            searchQuality * 100
          ).toFixed(
            0
          )}%). Present information clearly while noting any limitations in the available context.`;
        }
      } else if (confidenceLevel === "medium") {
        return `**CONFIDENCE GUIDANCE**: You have MEDIUM confidence with available context (quality: ${(
          searchQuality * 100
        ).toFixed(
          0
        )}%). Present information while acknowledging any limitations or uncertainties. Be helpful but honest about what you can and cannot determine.`;
      } else {
        return `**CONFIDENCE GUIDANCE**: You have LOW confidence with limited context (quality: ${(
          searchQuality * 100
        ).toFixed(
          0
        )}%). Be transparent about limitations and actively seek clarification or additional context through tools. Focus on asking good questions to better understand the user's needs.`;
      }
    }
  }

  private getContextUsageGuidance(
    intentAnalysis: IntentAnalysisResult
  ): string {
    const strategy = intentAnalysis.contextRetrievalStrategy;
    const relationshipToHistory = intentAnalysis.relationshipToHistory;
    const searchQuality =
      intentAnalysis.confidenceFactors.searchResultQuality || 0.5;
    const confidenceLevel = intentAnalysis.confidenceLevel;

    // Add confidence indicator based on search quality
    const qualityIndicator =
      searchQuality >= 0.8
        ? "🟢 High-quality context available"
        : searchQuality >= 0.6
        ? "🟡 Moderate-quality context available"
        : "🔴 Limited context quality";

    const confidenceNote =
      confidenceLevel === "high"
        ? " (High confidence)"
        : confidenceLevel === "medium"
        ? " (Medium confidence)"
        : " (Low confidence - be cautious)";

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
  ): Promise<{
    context: ConversationContext;
    updatedIntentAnalysis: IntentAnalysisResult;
  }> {
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
      const updatedIntentAnalysis =
        this.intentAnalysisService.updateConfidenceWithSearchResults(
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

      // Check and create summaries if needed
      try {
        await this.conversationSummaryService.checkAndCreateSummary(
          context.conversationId!,
          savedUserMessageId,
          context.userId
        );
      } catch (summaryError) {
        console.error("Error creating conversation summary:", summaryError);
        // Don't throw here to avoid breaking the response flow
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

  private generateReasoningExplanation(
    intentAnalysis: IntentAnalysisResult,
    toolsUsed: ToolUsageContext[],
    context: ConversationContext
  ): {
    actionsPerformed: string[];
    contextUsed: string;
    decisionProcess: string;
  } {
    const actionsPerformed: string[] = [];

    // Document actions taken
    actionsPerformed.push(
      `Analyzed user intent: "${intentAnalysis.currentIntent}"`
    );

    if (toolsUsed.length > 0) {
      const successfulTools = toolsUsed.filter((tool) => tool.success);
      const failedTools = toolsUsed.filter((tool) => !tool.success);

      successfulTools.forEach((tool) => {
        actionsPerformed.push(`Successfully executed ${tool.toolName} tool`);
      });

      failedTools.forEach((tool) => {
        actionsPerformed.push(
          `Attempted ${tool.toolName} tool (encountered issues)`
        );
      });
    }

    actionsPerformed.push(
      "Generated response based on analysis and available context"
    );

    // Explain context usage
    let contextUsed: string;
    if (intentAnalysis.contextualRelevance === "high") {
      contextUsed = `Used ${context.messageHistory.length} previous messages from conversation history as they were highly relevant to understanding and responding to your request.`;
    } else if (intentAnalysis.contextualRelevance === "medium") {
      contextUsed = `Referenced conversation history selectively, focusing on the most relevant parts to provide better context for your request.`;
    } else {
      contextUsed = `Treated this as a fresh request with minimal reliance on conversation history, focusing primarily on your current message.`;
    }

    // Explain decision process
    const decisionProcess = [
      `I analyzed your message with ${intentAnalysis.confidenceScore}% confidence in understanding your intent.`,
      `Based on the ${intentAnalysis.contextualRelevance} relevance to our conversation history, I chose a ${intentAnalysis.contextRetrievalStrategy} approach.`,
      toolsUsed.length > 0
        ? `I determined that ${toolsUsed.length} tool${
            toolsUsed.length > 1 ? "s were" : " was"
          } needed to provide a complete response.`
        : `I determined that I could provide a complete response without using external tools.`,
      intentAnalysis.keyTopics && intentAnalysis.keyTopics.length > 0
        ? `I focused on these key topics: ${intentAnalysis.keyTopics.join(
            ", "
          )}.`
        : `I addressed your request comprehensively without identifying specific topic constraints.`,
    ].join(" ");

    return {
      actionsPerformed,
      contextUsed,
      decisionProcess,
    };
  }
}
