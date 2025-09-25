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
  SummaryResult,
} from "./conversation-summary-service";
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
    this.toolRegistry = toolRegistry || new ToolRegistry(this.prisma);
    this.intentAnalysisService = new IntentAnalysisService(
      this.prisma,
      this.openai
    );
    this.conversationSummaryService = new ConversationSummaryService(
      this.prisma,
      this.openai
    );

    this.config = {
      model: process.env.DEFAULT_AGENT_MODEL || "gpt-4o-mini",
      temperature: parseFloat(process.env.AGENT_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || "16384"),
      timeout: parseInt(process.env.AGENT_TIMEOUT_MS || "30000"),
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
    return `You are a helpful AI assistant with access to web search capabilities. 
You can search the web to find current information and provide accurate, up-to-date responses.
When you need to search for information, use the web_search tool.
Always be helpful, accurate, and cite your sources when using web search results.`;
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
      // Load conversation context
      const context = await this.loadConversationContext(
        conversationId,
        request.userId
      );

      console.log("📚 [AGENT] Loaded conversation context:", {
        conversationId,
        messageHistoryCount: context.messageHistory.length,
        userId: context.userId,
      });

      // Add user message to context
      const userMessage: MessageContext = {
        role: Role.USER,
        content: request.message,
        timestamp: new Date(),
      };
      context.messageHistory.push(userMessage);

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
      });

      // Check if we need to create a conversation summary
      console.log("📊 [AGENT] Checking for conversation summarization");
      const summaryResult =
        await this.conversationSummaryService.checkAndCreateSummary(
          conversationId
        );

      if (summaryResult) {
        console.log("📊 [AGENT] Created conversation summary:", {
          messageCount: summaryResult.messageRange.messageCount,
          summaryLevel: summaryResult.summaryLevel,
          keyTopics: summaryResult.keyTopics,
        });
      }

      // Prepare messages for OpenAI with intent analysis context
      const messages = this.prepareMessagesForOpenAI(context, intentAnalysis);

      // Console logging: System prompt and messages
      console.log("💬 [AGENT] Prepared messages for OpenAI:", {
        systemPrompt: this.config.systemPrompt.substring(0, 200) + "...",
        messageCount: messages.length,
        totalCharacters: JSON.stringify(messages).length,
      });

      console.log("📋 [AGENT] Full message payload:", {
        messages: messages.map((msg) => ({
          role: msg.role,
          contentLength: msg.content?.length || 0,
          contentPreview: msg.content?.substring(0, 100) + "...",
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

    // Enhance system prompt with intent analysis context
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

Use this context to provide more relevant and focused responses that align with the user's current intent and conversation flow.`;
    }

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Add conversation history (limit to maxConversationHistory)
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

  private async loadConversationContext(
    conversationId: string,
    userId?: string
  ): Promise<ConversationContext> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            include: {
              toolUsages: true,
            },
          },
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

      const messageHistory: MessageContext[] = conversation.messages.map(
        (msg) => ({
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
        })
      );

      return {
        conversationId,
        userId: conversation.userId || "anonymous",
        messageHistory,
        metadata: {},
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
