import { PrismaClient, UsageOperationType } from "@prisma/client";
import OpenAI from "openai";
import { SmartContextResult } from "./smart-context-service";
import { UsageTrackingService } from "./usage-tracking-service";

export interface ToolExecutionPlan {
  toolName: string;
  priority: "critical" | "high" | "medium" | "low";
  required: boolean;
  reasoning: string;
  parameters: {
    semanticSearchQueries?: string[];
    dateQuery?: string;
    includeHours?: boolean;
    maxContextItems?: number;
    webSearchQuery?: string;
    searchDomains?: string[];
  };
  timeout?: number;
  retryCount?: number;
  fallbackTools?: string[];
}

export interface IntentAnalysisResult {
  currentIntent: string;
  contextualRelevance: "high" | "medium" | "low";
  relationshipToHistory:
    | "continuation"
    | "new_topic"
    | "clarification"
    | "recall";
  keyTopics: string[];
  pendingQuestions: string[];
  lastAssistantQuestion?: string | undefined;
  compressedContext: string;
  analysisResult: any;
  needsHistoricalContext: boolean;
  
  // NEW: AI-driven multi-tool execution
  toolExecutionPlan: ToolExecutionPlan[];
  queryType: "simple" | "hybrid_temporal_current" | "hybrid_topic_current" | "comprehensive" | "temporal_only" | "current_only";
  executionStrategy: "single" | "parallel" | "sequential" | "conditional";
  
  // DEPRECATED: Keep for backward compatibility during transition
  contextRetrievalStrategy:
    | "none"
    | "recent_only"
    | "semantic_search"
    | "all_available"
    | "date_based_search";
  semanticSearchQueries?: string[];
  maxContextItems?: number;
  dateQuery?: string;
  includeHours?: boolean;
  
  // Enhanced confidence scoring
  confidenceLevel: "high" | "medium" | "low";
  confidenceScore: number; // 0-1 scale
  confidenceFactors: {
    searchResultQuality?: number; // 0-1 scale based on similarity scores
    contextAvailability?: number; // 0-1 scale based on amount of relevant context
    querySpecificity?: number; // 0-1 scale based on how specific the query is
    historicalMatch?: number; // 0-1 scale based on how well historical data matches
    toolSelectionConfidence?: number; // 0-1 scale based on AI's confidence in tool selection
  };
}

export interface ConversationContext {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
    isSummary?: boolean;
  }>;
  summaries: Array<{
    summaryText: string;
    topicName: string;
    relatedTopics: any;
    messageRange: any;
    summaryLevel: number;
    topicRelevance: number;
  }>;
  lastIntentAnalysis?: {
    currentIntent: string;
    keyTopics: any;
    pendingQuestions: any;
    lastAssistantQuestion?: string | null;
  };
}

export class IntentAnalysisService {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private usageTrackingService: UsageTrackingService;

  constructor(prisma: PrismaClient, openai: OpenAI) {
    this.prisma = prisma;
    this.openai = openai;
    this.usageTrackingService = new UsageTrackingService(prisma);
  }

  async analyzeIntent(
    conversationId: string,
    userMessageId: string,
    currentPrompt: string,
    userId?: string
  ): Promise<IntentAnalysisResult> {
    // Stage 1: Load minimal context and determine strategy
    const minimalContext = await this.loadMinimalContext(conversationId);
    const initialAnalysis = await this.performIntentAnalysis(
      minimalContext,
      currentPrompt,
      conversationId,
      userMessageId,
      userId
    );

    // Stage 2: Load appropriate context based on strategy
    let finalContext: ConversationContext;
    if (initialAnalysis.contextRetrievalStrategy === "semantic_search") {
      // TODO: Implement semantic search based context loading
      finalContext = await this.loadConversationContext(conversationId);
    } else if (
      initialAnalysis.contextRetrievalStrategy === "date_based_search"
    ) {
      // Load context with date-based search results
      finalContext = await this.loadConversationContext(conversationId);
    } else if (initialAnalysis.contextRetrievalStrategy === "all_available") {
      finalContext = await this.loadConversationContext(conversationId);
    } else if (initialAnalysis.contextRetrievalStrategy === "recent_only") {
      finalContext = minimalContext; // Use minimal context
    } else {
      finalContext = minimalContext; // 'none' strategy
    }

    // Stage 3: Perform final analysis with appropriate context (if different from initial)
    let finalAnalysis: IntentAnalysisResult;
    if (finalContext !== minimalContext) {
      finalAnalysis = await this.performIntentAnalysis(
        finalContext,
        currentPrompt,
        conversationId,
        userMessageId,
        userId
      );
    } else {
      finalAnalysis = initialAnalysis;
    }

    // Store the analysis result
    await this.storeIntentAnalysis(
      conversationId,
      userMessageId,
      finalAnalysis
    );

    return finalAnalysis;
  }

  private async loadMinimalContext(
    conversationId: string
  ): Promise<ConversationContext> {
    // Load only recent messages for initial intent analysis
    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 10, // Only last 10 messages
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    // Get the last intent analysis for context
    const lastIntentAnalysis = await this.prisma.intentAnalysis.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: {
        currentIntent: true,
        keyTopics: true,
        pendingQuestions: true,
        lastAssistantQuestion: true,
      },
    });

    const context: ConversationContext = {
      messages: recentMessages.reverse().map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      })),
      summaries: [], // No summaries in minimal context
    };

    if (lastIntentAnalysis) {
      context.lastIntentAnalysis = {
        currentIntent: lastIntentAnalysis.currentIntent,
        keyTopics: lastIntentAnalysis.keyTopics,
        pendingQuestions: lastIntentAnalysis.pendingQuestions,
        lastAssistantQuestion: lastIntentAnalysis.lastAssistantQuestion,
      };
    }

    return context;
  }

  private async loadConversationContext(
    conversationId: string
  ): Promise<ConversationContext> {
    // Load last 6 messages (3 turns) regardless of summary status
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: { createdAt: "desc" },
      take: 6, // Last 3 turns (USER + ASSISTANT pairs)
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    // Load conversation summaries for additional context
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" }, // Changed to asc for chronological order
      select: {
        summaryText: true,
        topicName: true,
        relatedTopics: true,
        messageRange: true,
        summaryLevel: true,
        topicRelevance: true,
      },
    });

    // Load last intent analysis for context
    const lastIntentAnalysis = await this.prisma.intentAnalysis.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: {
        currentIntent: true,
        keyTopics: true,
        pendingQuestions: true,
        lastAssistantQuestion: true,
      },
    });

    // Transform the last 3 turns of messages (reverse order since we got them desc)
    const transformedMessages = messages.reverse().map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      isSummary: false,
    }));

    const context: ConversationContext = {
      messages: transformedMessages,
      summaries,
    };

    if (lastIntentAnalysis) {
      context.lastIntentAnalysis = {
        currentIntent: lastIntentAnalysis.currentIntent,
        keyTopics: lastIntentAnalysis.keyTopics,
        pendingQuestions: lastIntentAnalysis.pendingQuestions,
        lastAssistantQuestion: lastIntentAnalysis.lastAssistantQuestion,
      };
    }

    return context;
  }

  private async performIntentAnalysis(
    context: ConversationContext,
    currentPrompt: string,
    conversationId: string,
    userMessageId: string,
    userId?: string
  ): Promise<IntentAnalysisResult> {
    // Build context for OpenAI
    const contextText = this.buildContextText(context);

    const systemPrompt = `You are an expert conversation analyst with advanced multi-tool execution planning capabilities. Your task is to analyze the user's current prompt in the context of their conversation history and provide a structured intent analysis with an intelligent tool execution plan.

CORE ANALYSIS RULES:
1. Analyze the user's current intent based on their prompt and conversation history
2. Determine how the current prompt relates to previous conversation
3. Identify key topics and any pending questions from the assistant
4. Provide a compressed context summary for efficient processing
5. Rate contextual relevance as high/medium/low
6. **CRITICALLY**: Intelligently plan which tools are needed and how to execute them

CURRENT INTENT GUIDELINES:
- Provide a detailed, specific description of what the user wants to achieve
- Include the type of action they're requesting (e.g., "create", "fix", "explain", "analyze", "implement")
- Mention the specific domain/technology/topic they're working with
- Include any constraints, preferences, or specific requirements they mentioned
- If it's a follow-up, reference what they're building upon
- Keep it concise but comprehensive (3-5 sentences)

AI-DRIVEN MULTI-TOOL EXECUTION PLANNING:

AVAILABLE TOOLS:
1. "semantic_topic_search" - Searches conversation history for specific topics, concepts, or subjects
2. "date_based_topic_search" - Searches conversation history for content from specific time periods
3. "web_search" - Searches the internet for current information, news, updates, or real-time data

QUERY TYPE CLASSIFICATION:
- "simple": Single tool needed, straightforward query
- "hybrid_temporal_current": Needs both historical temporal data AND current web information (e.g., "Indian News yesterday")
- "hybrid_topic_current": Needs both historical topic data AND current web information (e.g., "latest updates on AI we discussed")
- "comprehensive": Needs multiple tools for thorough analysis
- "temporal_only": Only needs historical time-based search
- "current_only": Only needs current web information

EXECUTION STRATEGY SELECTION:
- "single": One tool execution (for simple queries)
- "parallel": Multiple tools executed simultaneously (for hybrid queries requiring speed)
- "sequential": Tools executed in order (when one tool's results inform another)
- "conditional": Tool execution depends on results of previous tools

INTELLIGENT TOOL SELECTION LOGIC:

FOR HYBRID TEMPORAL + CURRENT QUERIES (e.g., "Indian News yesterday", "what happened with Tesla stock yesterday"):
- PRIMARY: "date_based_topic_search" (to get historical context from yesterday)
- SECONDARY: "web_search" (to get current/recent news about the topic)
- EXECUTION: "parallel" (both can run simultaneously)
- REASONING: User needs both what was discussed historically AND current information

FOR HYBRID TOPIC + CURRENT QUERIES (e.g., "latest updates on React we discussed", "new developments in AI since our conversation"):
- PRIMARY: "semantic_topic_search" (to get historical topic context)
- SECONDARY: "web_search" (to get latest updates on that topic)
- EXECUTION: "parallel" (both can run simultaneously)
- REASONING: User needs both historical context AND current developments

FOR TEMPORAL-ONLY QUERIES (e.g., "what did we discuss yesterday", "topics from last week"):
- SINGLE: "date_based_topic_search"
- EXECUTION: "single"
- REASONING: Only historical temporal data needed

FOR CURRENT-ONLY QUERIES (e.g., "latest news", "current weather", "today's stock prices"):
- SINGLE: "web_search"
- EXECUTION: "single"
- REASONING: Only current information needed

FOR TOPIC-ONLY QUERIES (e.g., "tell me about React we discussed", "what did we say about APIs"):
- SINGLE: "semantic_topic_search"
- EXECUTION: "single"
- REASONING: Only historical topic data needed

TOOL PRIORITY LEVELS:
- "critical": Tool is essential for answering the query
- "high": Tool provides important information
- "medium": Tool provides helpful context
- "low": Tool provides supplementary information

TOOL PARAMETER INTELLIGENCE:
- For semantic_topic_search: Generate specific search queries based on topics mentioned
- For date_based_topic_search: Extract precise temporal references and set appropriate granularity
- For web_search: Create focused search queries for current information needs

RESPONSE FORMAT (JSON):
{
  "currentIntent": "Detailed, specific description of what the user wants to achieve",
  "contextualRelevance": "high|medium|low",
  "relationshipToHistory": "continuation|new_topic|clarification|recall",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "pendingQuestions": ["question1", "question2"],
  "lastAssistantQuestion": "Last question asked by assistant (if any)",
  "compressedContext": "Brief summary of relevant context for this intent",
  "needsHistoricalContext": true|false,
  "toolExecutionPlan": [
    {
      "toolName": "semantic_topic_search|date_based_topic_search|web_search",
      "priority": "critical|high|medium|low",
      "required": true|false,
      "reasoning": "AI explanation for why this tool is needed and what it will provide",
      "parameters": {
        "semanticSearchQueries": ["query1", "query2"] (for semantic_topic_search),
        "dateQuery": "temporal reference" (for date_based_topic_search),
        "includeHours": true|false (for date_based_topic_search),
        "maxContextItems": 3-10 (for historical searches),
        "webSearchQuery": "search query" (for web_search),
        "searchDomains": ["domain1.com"] (optional, for web_search)
      },
      "timeout": 30000 (optional, in milliseconds),
      "retryCount": 2 (optional),
      "fallbackTools": ["alternative_tool"] (optional)
    }
  ],
  "queryType": "simple|hybrid_temporal_current|hybrid_topic_current|comprehensive|temporal_only|current_only",
  "executionStrategy": "single|parallel|sequential|conditional"
}

CRITICAL HYBRID QUERY DETECTION:
- If query contains BOTH temporal references AND requests for current information → "hybrid_temporal_current"
- If query references BOTH past topics AND requests for latest/current updates → "hybrid_topic_current"
- If query asks for comprehensive analysis requiring multiple data sources → "comprehensive"

EXAMPLES OF HYBRID QUERIES:
- "Indian News yesterday" → hybrid_temporal_current (needs both historical context from yesterday AND current Indian news)
- "latest updates on AI from last week" → hybrid_topic_current (needs both what was discussed about AI last week AND current AI updates)
- "what's new with Tesla since we talked about it" → hybrid_topic_current (needs both historical Tesla discussion AND current Tesla news)
- "cryptocurrency trends from yesterday and today" → hybrid_temporal_current (needs both yesterday's context AND today's trends)

INTELLIGENT REASONING REQUIREMENTS:
- Each tool in the execution plan MUST have clear, specific reasoning
- Reasoning should explain what information the tool will provide and why it's needed
- Consider tool interdependencies and result synthesis
- Plan for graceful degradation if tools fail

GUIDELINES:
- Always prioritize user intent and information completeness
- Plan for parallel execution when tools are independent
- Use sequential execution when tools build on each other
- Provide fallback tools for critical information needs
- Keep tool parameters specific and actionable`;

    const startTime = Date.now();
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `CONVERSATION CONTEXT:\n${contextText}\n\nCURRENT USER PROMPT:\n${currentPrompt}\n\nProvide intent analysis.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "intent_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                currentIntent: {
                  type: "string",
                  description:
                    "Clear description of what the user wants to achieve",
                },
                contextualRelevance: {
                  type: "string",
                  enum: ["high", "medium", "low"],
                  description:
                    "How relevant the current prompt is to conversation history",
                },
                relationshipToHistory: {
                  type: "string",
                  enum: [
                    "continuation",
                    "new_topic",
                    "clarification",
                    "recall",
                  ],
                  description:
                    "How the current prompt relates to previous conversation",
                },
                keyTopics: {
                  type: "array",
                  items: { type: "string" },
                  description: "Key topics identified in the current prompt",
                },
                pendingQuestions: {
                  type: "array",
                  items: { type: "string" },
                  description: "Questions that still need follow-up",
                },
                lastAssistantQuestion: {
                  type: ["string", "null"],
                  description: "Last question asked by assistant (if any)",
                },
                compressedContext: {
                  type: "string",
                  description:
                    "Brief summary of relevant context for this intent",
                },
                needsHistoricalContext: {
                  type: "boolean",
                  description:
                    "Whether historical context is needed for this query",
                },
                toolExecutionPlan: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      toolName: {
                        type: "string",
                        enum: ["semantic_topic_search", "date_based_topic_search", "web_search"],
                        description: "Name of the tool to execute"
                      },
                      priority: {
                        type: "string",
                        enum: ["critical", "high", "medium", "low"],
                        description: "Priority level for tool execution"
                      },
                      required: {
                        type: "boolean",
                        description: "Whether this tool is required for the query"
                      },
                      reasoning: {
                        type: "string",
                        description: "AI reasoning for why this tool is needed"
                      },
                      parameters: {
                          type: "object",
                          description: "Tool execution parameters - flexible object allowing various parameter combinations",
                          additionalProperties: true
                        },
                      timeout: {
                        type: "integer",
                        description: "Timeout in milliseconds for tool execution"
                      },
                      retryCount: {
                        type: "integer",
                        description: "Number of retries if tool fails"
                      },
                      fallbackTools: {
                        type: "array",
                        items: { type: "string" },
                        description: "Alternative tools if this one fails"
                      }
                    },
                    required: ["toolName", "priority", "required", "reasoning", "parameters"],
                    additionalProperties: false
                  },
                  description: "AI-generated plan for tool execution"
                },
                queryType: {
                  type: "string",
                  enum: ["simple", "hybrid_temporal_current", "hybrid_topic_current", "comprehensive", "temporal_only", "current_only"],
                  description: "Type of query requiring specific tool combinations"
                },
                executionStrategy: {
                  type: "string",
                  enum: ["single", "parallel", "sequential", "conditional"],
                  description: "Strategy for executing multiple tools"
                },
              },
              required: [
                "currentIntent",
                "contextualRelevance",
                "relationshipToHistory",
                "keyTopics",
                "pendingQuestions",
                "lastAssistantQuestion",
                "compressedContext",
                "needsHistoricalContext",
                "toolExecutionPlan",
                "queryType",
                "executionStrategy",
              ],
              additionalProperties: false,
            },
          },
        },
      });

      const analysisText = response.choices[0]?.message?.content;
      if (!analysisText) {
        throw new Error("No analysis response received");
      }

      // With structured output, this is guaranteed to be valid JSON
      const analysis = JSON.parse(analysisText);

      // Track usage for intent analysis
      const duration = Date.now() - startTime;
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;

      const usageData: any = {
        conversationId,
        messageId: userMessageId,
        operationType: UsageOperationType.INTENT_ANALYSIS,
        operationSubtype: "intent_analysis",
        model: "gpt-4o-mini",
        inputTokens,
        outputTokens,
        duration,
        success: true,
        metadata: {
          contextRetrievalStrategy: analysis.contextRetrievalStrategy,
          needsHistoricalContext: analysis.needsHistoricalContext,
          keyTopicsCount: analysis.keyTopics?.length || 0,
          confidenceLevel: "pending", // Will be calculated later
        },
      };

      if (userId) {
        usageData.userId = userId;
      }

      await this.usageTrackingService.trackUsage(usageData);

      // Debug logging for date-based queries
      if (analysis.contextRetrievalStrategy === "date_based_search") {
        console.log("🗓️ [DEBUG] Date-based search detected:", {
          dateQuery: analysis.dateQuery,
          includeHours: analysis.includeHours,
          maxContextItems: analysis.maxContextItems,
          currentPrompt: currentPrompt.substring(0, 100) + "...",
        });
      }

      // Calculate confidence based on analysis results
      const confidence = this.calculateConfidence(
        analysis,
        currentPrompt,
        context
      );

      return {
        currentIntent: analysis.currentIntent,
        contextualRelevance: analysis.contextualRelevance,
        relationshipToHistory: analysis.relationshipToHistory,
        keyTopics: analysis.keyTopics || [],
        pendingQuestions: analysis.pendingQuestions || [],
        lastAssistantQuestion: analysis.lastAssistantQuestion,
        compressedContext: analysis.compressedContext,
        analysisResult: analysis,
        needsHistoricalContext: analysis.needsHistoricalContext,
        // New AI-driven multi-tool execution fields
        toolExecutionPlan: analysis.toolExecutionPlan || [],
        queryType: analysis.queryType || "simple",
        executionStrategy: analysis.executionStrategy || "single",
        // Legacy fields for backward compatibility
        contextRetrievalStrategy: analysis.contextRetrievalStrategy || "none",
        semanticSearchQueries: analysis.semanticSearchQueries,
        maxContextItems: analysis.maxContextItems,
        dateQuery: analysis.dateQuery,
        includeHours: analysis.includeHours,
        confidenceLevel: confidence.level,
        confidenceScore: confidence.score,
        confidenceFactors: confidence.factors,
      };
    } catch (error) {
      console.error("Intent analysis failed:", error);

      // Track failed usage
      const duration = Date.now() - startTime;
      const usageData: any = {
        conversationId,
        messageId: userMessageId,
        operationType: UsageOperationType.INTENT_ANALYSIS,
        operationSubtype: "intent_analysis",
        model: "gpt-4o-mini",
        inputTokens: 0,
        outputTokens: 0,
        duration,
        success: false,
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error",
          fallbackUsed: true,
        },
      };

      if (userId) {
        usageData.userId = userId;
      }

      await this.usageTrackingService.trackUsage(usageData);

      // Fallback analysis with low confidence
      return {
        currentIntent: "User query requiring assistance",
        contextualRelevance: "medium",
        relationshipToHistory: "continuation",
        keyTopics: [],
        pendingQuestions: [],
        compressedContext: "Context analysis unavailable",
        analysisResult: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        needsHistoricalContext: true,
        // New AI-driven multi-tool execution fields with fallback values
        toolExecutionPlan: [{
          toolName: "semantic_topic_search",
          priority: "medium",
          required: true,
          reasoning: "Fallback to basic semantic search due to analysis failure",
          parameters: {
            semanticSearchQueries: [currentPrompt],
            maxContextItems: 5
          }
        }],
        queryType: "simple",
        executionStrategy: "single",
        // Legacy fields for backward compatibility
        contextRetrievalStrategy: "recent_only",
        semanticSearchQueries: [],
        maxContextItems: 5,
        confidenceLevel: "low",
        confidenceScore: 0.2,
        confidenceFactors: {
          searchResultQuality: 0.0,
          contextAvailability: 0.0,
          querySpecificity: 0.0,
          historicalMatch: 0.0,
        },
      };
    }
  }

  private buildContextText(context: ConversationContext): string {
    let contextText = "";

    // Add summaries if available
    if (context.summaries.length > 0) {
      contextText += "CONVERSATION SUMMARIES:\n";
      context.summaries.forEach((summary, index) => {
        contextText += `Summary ${index + 1} (Level ${summary.summaryLevel}): ${
          summary.summaryText
        }\n`;
        contextText += `Topic: ${summary.topicName} (Relevance: ${summary.topicRelevance})\n`;
        if (summary.relatedTopics && Array.isArray(summary.relatedTopics)) {
          contextText += `Related Topics: ${(
            summary.relatedTopics as string[]
          ).join(", ")}\n`;
        }
        contextText += "\n";
      });
    }

    // Add recent messages
    if (context.messages.length > 0) {
      contextText += "RECENT MESSAGES:\n";
      context.messages.forEach((message) => {
        contextText += `${message.role.toUpperCase()}: ${message.content}\n`;
      });
    }

    // Add last intent analysis context
    if (context.lastIntentAnalysis) {
      contextText += "\nLAST INTENT ANALYSIS:\n";
      contextText += `Intent: ${context.lastIntentAnalysis.currentIntent}\n`;
      contextText += `Topics: ${context.lastIntentAnalysis.keyTopics.join(
        ", "
      )}\n`;
      if (context.lastIntentAnalysis.pendingQuestions.length > 0) {
        contextText += `Pending Questions: ${context.lastIntentAnalysis.pendingQuestions.join(
          ", "
        )}\n`;
      }
      if (context.lastIntentAnalysis.lastAssistantQuestion) {
        contextText += `Last Assistant Question: ${context.lastIntentAnalysis.lastAssistantQuestion}\n`;
      }
    }

    return contextText;
  }

  private async storeIntentAnalysis(
    conversationId: string,
    userMessageId: string,
    analysis: IntentAnalysisResult
  ): Promise<void> {
    await this.prisma.intentAnalysis.create({
      data: {
        conversationId,
        userMessageId,
        currentIntent: analysis.currentIntent,
        contextualRelevance: analysis.contextualRelevance,
        relationshipToHistory: analysis.relationshipToHistory,
        keyTopics: analysis.keyTopics,
        pendingQuestions: analysis.pendingQuestions,
        lastAssistantQuestion: analysis.lastAssistantQuestion || null,
        analysisResult: analysis.analysisResult,
      },
    });
  }

  async getLatestIntentAnalysis(
    conversationId: string
  ): Promise<IntentAnalysisResult | null> {
    const analysis = await this.prisma.intentAnalysis.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });

    if (!analysis) return null;

    return {
      currentIntent: analysis.currentIntent,
      contextualRelevance: analysis.contextualRelevance as
        | "high"
        | "medium"
        | "low",
      relationshipToHistory: analysis.relationshipToHistory as
        | "continuation"
        | "new_topic"
        | "clarification",
      keyTopics: analysis.keyTopics as string[],
      pendingQuestions: analysis.pendingQuestions as string[],
      lastAssistantQuestion: analysis.lastAssistantQuestion || undefined,
      compressedContext: "", // Not stored separately, would need to regenerate
      analysisResult: analysis.analysisResult,
      needsHistoricalContext: true, // Default assumption for stored analysis
      // New AI-driven multi-tool execution fields with default values
      toolExecutionPlan: [{
        toolName: "semantic_topic_search",
        priority: "medium",
        required: true,
        reasoning: "Default semantic search for stored analysis",
        parameters: {
          semanticSearchQueries: [analysis.currentIntent],
          maxContextItems: 5
        }
      }],
      queryType: "simple",
      executionStrategy: "single",
      // Legacy fields for backward compatibility
      contextRetrievalStrategy: "recent_only", // Default strategy
      semanticSearchQueries: [], // Default empty array
      maxContextItems: 5, // Default value
      confidenceLevel: "medium", // Default for stored analysis
      confidenceScore: 0.5, // Default neutral score
      confidenceFactors: {
        searchResultQuality: 0.5,
        contextAvailability: 0.5,
        querySpecificity: 0.5,
        historicalMatch: 0.5,
      },
    };
  }

  private calculateConfidence(
    analysis: any,
    currentPrompt: string,
    context: ConversationContext
  ): {
    level: "high" | "medium" | "low";
    score: number;
    factors: {
      searchResultQuality?: number;
      contextAvailability?: number;
      querySpecificity?: number;
      historicalMatch?: number;
    };
  } {
    const factors = {
      searchResultQuality: 0.5, // Default neutral
      contextAvailability: 0.5, // Default neutral
      querySpecificity: 0.5, // Default neutral
      historicalMatch: 0.5, // Default neutral
    };

    // Calculate query specificity based on prompt characteristics
    factors.querySpecificity = this.calculateQuerySpecificity(
      currentPrompt,
      analysis
    );

    // Calculate context availability based on available context
    factors.contextAvailability = this.calculateContextAvailability(
      context,
      analysis
    );

    // For recall queries, we'll update search result quality later when we have search results
    if (analysis.relationshipToHistory === "recall") {
      // Recall queries start with medium confidence, will be updated based on search results
      factors.searchResultQuality = 0.6;
      factors.historicalMatch = 0.6;
    }

    // Calculate overall confidence score (weighted average)
    const weights = {
      searchResultQuality: 0.3,
      contextAvailability: 0.25,
      querySpecificity: 0.25,
      historicalMatch: 0.2,
    };

    const score =
      factors.searchResultQuality * weights.searchResultQuality +
      factors.contextAvailability * weights.contextAvailability +
      factors.querySpecificity * weights.querySpecificity +
      factors.historicalMatch * weights.historicalMatch;

    // Determine confidence level
    let level: "high" | "medium" | "low";
    if (score >= 0.75) {
      level = "high";
    } else if (score >= 0.5) {
      level = "medium";
    } else {
      level = "low";
    }

    return { level, score, factors };
  }

  private calculateQuerySpecificity(prompt: string, analysis: any): number {
    let specificity = 0.5; // Base score

    // Check for specific recall indicators
    const recallIndicators = [
      "what did we discuss",
      "remember when",
      "tell me about",
      "what was the word",
      "definition",
      "we talked about",
    ];

    const hasRecallIndicators = recallIndicators.some((indicator) =>
      prompt.toLowerCase().includes(indicator)
    );

    if (hasRecallIndicators) {
      specificity += 0.2;
    }

    // Check for specific topics or keywords
    if (analysis.keyTopics && analysis.keyTopics.length > 0) {
      specificity += Math.min(analysis.keyTopics.length * 0.1, 0.3);
    }

    // Check for question words that indicate specific information seeking
    const questionWords = ["what", "when", "where", "who", "how", "which"];
    const hasQuestionWords = questionWords.some((word) =>
      prompt.toLowerCase().includes(word)
    );

    if (hasQuestionWords) {
      specificity += 0.1;
    }

    return Math.min(specificity, 1.0);
  }

  private calculateContextAvailability(
    context: ConversationContext,
    analysis: any
  ): number {
    let availability = 0.3; // Base score

    // Check message history availability
    if (context.messages && context.messages.length > 0) {
      availability += Math.min(context.messages.length * 0.05, 0.3);
    }

    // Check summaries availability
    if (context.summaries && context.summaries.length > 0) {
      availability += Math.min(context.summaries.length * 0.1, 0.4);
    }

    return Math.min(availability, 1.0);
  }

  /**
   * Updates confidence scores based on actual search results from smart context service
   */
  updateConfidenceWithSearchResults(
    intentAnalysis: IntentAnalysisResult,
    smartContextResult: SmartContextResult
  ): IntentAnalysisResult {
    if (!smartContextResult.confidence) {
      return intentAnalysis; // No confidence data available
    }

    const { confidence } = smartContextResult;

    // Update search result quality with actual data
    intentAnalysis.confidenceFactors.searchResultQuality =
      confidence.searchResultQuality;

    // Update historical match based on search results
    if (confidence.hasStrongMatches) {
      intentAnalysis.confidenceFactors.historicalMatch = Math.max(
        confidence.averageSimilarity,
        0.7
      );
    } else if (confidence.resultCount > 0) {
      intentAnalysis.confidenceFactors.historicalMatch =
        confidence.averageSimilarity;
    } else {
      intentAnalysis.confidenceFactors.historicalMatch = 0.1; // Very low if no results
    }

    // Recalculate overall confidence score
    const factors = intentAnalysis.confidenceFactors;
    const weights = {
      searchResultQuality: 0.35,
      contextAvailability: 0.25,
      querySpecificity: 0.25,
      historicalMatch: 0.15,
    };

    intentAnalysis.confidenceScore =
      (factors.searchResultQuality || 0) * weights.searchResultQuality +
      (factors.contextAvailability || 0) * weights.contextAvailability +
      (factors.querySpecificity || 0) * weights.querySpecificity +
      (factors.historicalMatch || 0) * weights.historicalMatch;

    // Update confidence level based on new score
    if (intentAnalysis.confidenceScore >= 0.7) {
      intentAnalysis.confidenceLevel = "high";
    } else if (intentAnalysis.confidenceScore >= 0.4) {
      intentAnalysis.confidenceLevel = "medium";
    } else {
      intentAnalysis.confidenceLevel = "low";
    }

    return intentAnalysis;
  }
}
