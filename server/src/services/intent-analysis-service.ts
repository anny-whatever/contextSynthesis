import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

export interface IntentAnalysisResult {
  currentIntent: string;
  contextualRelevance: "high" | "medium" | "low";
  relationshipToHistory: "continuation" | "new_topic" | "clarification";
  keyTopics: string[];
  pendingQuestions: string[];
  lastAssistantQuestion?: string | undefined;
  compressedContext: string;
  analysisResult: any;
  needsHistoricalContext: boolean;
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

  constructor(prisma: PrismaClient, openai: OpenAI) {
    this.prisma = prisma;
    this.openai = openai;
  }

  async analyzeIntent(
    conversationId: string,
    userMessageId: string,
    currentPrompt: string
  ): Promise<IntentAnalysisResult> {
    // Stage 1: Load minimal context and determine strategy
    const minimalContext = await this.loadMinimalContext(conversationId);
    const initialAnalysis = await this.performIntentAnalysis(minimalContext, currentPrompt);

    // Stage 2: Load appropriate context based on strategy
    let finalContext: ConversationContext;
    if (initialAnalysis.contextRetrievalStrategy === 'semantic_search') {
      // TODO: Implement semantic search based context loading
      finalContext = await this.loadConversationContext(conversationId);
    } else if (initialAnalysis.contextRetrievalStrategy === 'all_available') {
      finalContext = await this.loadConversationContext(conversationId);
    } else if (initialAnalysis.contextRetrievalStrategy === 'recent_only') {
      finalContext = minimalContext; // Use minimal context
    } else {
      finalContext = minimalContext; // 'none' strategy
    }

    // Stage 3: Perform final analysis with appropriate context (if different from initial)
    let finalAnalysis: IntentAnalysisResult;
    if (finalContext !== minimalContext) {
      finalAnalysis = await this.performIntentAnalysis(finalContext, currentPrompt);
    } else {
      finalAnalysis = initialAnalysis;
    }

    // Store the analysis result
    await this.storeIntentAnalysis(conversationId, userMessageId, finalAnalysis);

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
    currentPrompt: string
  ): Promise<IntentAnalysisResult> {
    // Build context for OpenAI
    const contextText = this.buildContextText(context);

    const systemPrompt = `You are an expert conversation analyst. Your task is to analyze the user's current prompt in the context of their conversation history and provide a structured intent analysis.

CONTEXT ANALYSIS RULES:
1. Analyze the user's current intent based on their prompt and conversation history
2. Determine how the current prompt relates to previous conversation
3. Identify key topics and any pending questions from the assistant
4. Provide a compressed context summary for efficient processing
5. Rate contextual relevance as high/medium/low
6. Determine if historical context is needed and what retrieval strategy to use
7. Generate semantic search queries if needed for context retrieval
8. Detect date-based queries and temporal references for time-specific context retrieval

CURRENT INTENT GUIDELINES:
- Provide a detailed, specific description of what the user wants to achieve
- Include the type of action they're requesting (e.g., "create", "fix", "explain", "analyze", "implement")
- Mention the specific domain/technology/topic they're working with
- Include any constraints, preferences, or specific requirements they mentioned
- If it's a follow-up, reference what they're building upon
- Keep it concise but comprehensive (3-5 sentences)

Examples of good currentIntent:
- "User wants to implement a dark mode toggle feature in their React application with proper state management and CSS transitions"
- "User is requesting help to debug a TypeScript compilation error related to missing interface properties in their intent analysis service"
- "User wants to enhance the detail level of intent descriptions generated by their AI conversation analysis system"

RESPONSE FORMAT (JSON):
{
  "currentIntent": "Detailed, specific description of what the user wants to achieve, including action type, domain/technology, and any specific requirements or constraints",
  "contextualRelevance": "high|medium|low",
  "relationshipToHistory": "continuation|new_topic|clarification",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "pendingQuestions": ["question1", "question2"],
  "lastAssistantQuestion": "Last question asked by assistant (if any)",
  "compressedContext": "Brief summary of relevant context for this intent",
  "needsHistoricalContext": true|false,
  "contextRetrievalStrategy": "none|recent_only|semantic_search|all_available|date_based_search",
  "semanticSearchQueries": ["query1", "query2"] (always provide, empty array if not semantic_search),
  "dateQuery": "temporal reference if using date_based_search (e.g., 'yesterday', 'last 5 days', '2025-08-05')",
  "includeHours": true|false (whether hour-level granularity is needed),
  "maxContextItems": 3-10 (recommended number of context items to retrieve)
}

CONTEXT RETRIEVAL GUIDELINES:
- needsHistoricalContext: true if the query references past topics, needs background, or builds on previous discussion
- contextRetrievalStrategy:
  * "none": For simple greetings, basic questions that don't need history
  * "recent_only": For queries that only need the last few exchanges (last 2-3 messages)
  * "semantic_search": For queries about SPECIFIC TOPICS mentioned in the past, especially when user says "we talked about", "we discussed", "tell me about [specific thing]", or references specific subjects/items/concepts from history
  * "date_based_search": For queries with temporal references like "yesterday", "last week", "on August 5th", "what did we discuss last Monday", "topics from last 5 days", or any date-specific requests
  * "all_available": For complex queries needing comprehensive context across entire conversation
- semanticSearchQueries: Generate 1-3 specific search terms if using semantic_search strategy, empty array otherwise
- dateQuery: Extract the temporal reference if using date_based_search strategy (e.g., "yesterday", "last 5 days", "2025-08-05", "last week")
- includeHours: Set to true if the query requires hour-level granularity (e.g., "this morning", "this afternoon", "at 3pm yesterday")
- maxContextItems: 
  * For BASIC/CASUAL queries (simple questions, general topics): 3 items max
  * For DETAILED/SPECIFIC queries (asking for "detailed", "comprehensive", "all", "everything", "in-depth"): 5-8 items
  * For COMPREHENSIVE analysis: up to 10 items

QUERY CLASSIFICATION FOR CONTEXT RETRIEVAL:
- BASIC queries: Simple questions, casual references, general topics - limit to TOP 3 most recent/relevant results
- DETAILED queries: When user asks for "detailed", "comprehensive", "all information", "everything about", "in-depth", "complete" information - provide more comprehensive results
- EXACT MATCH queries: When user references specific topics with exact phrases from past conversations

CRITICAL SEMANTIC SEARCH RULE:
If the user's query references SPECIFIC TOPICS, ITEMS, or CONCEPTS from past conversation (using phrases like "we talked about", "we discussed", "what were the", "tell me about [X]", "what did we say about"), you MUST use "semantic_search" strategy REGARDLESS of whether those topics appear in the current context. The semantic search will find the most relevant historical information about those specific topics.

CRITICAL DATE-BASED SEARCH RULE:
If the user's query contains TEMPORAL REFERENCES or DATE-SPECIFIC requests, you MUST use "date_based_search" strategy. This includes:
- Relative time: "yesterday", "last week", "last 5 days", "last month", "this morning", "this afternoon"
- Specific dates: "on August 5th", "August 5, 2025", "2025-08-05", "last Monday", "this Tuesday"
- Date ranges: "from August 5th to 10th", "between last Monday and Wednesday", "in the last week"
- Time-specific queries: "what did we discuss yesterday?", "topics from last 5 days", "what happened on Monday?"

IMPORTANT: Use "semantic_search" when the user:
- References specific topics, items, or concepts from past conversation
- Uses phrases like "we talked about", "we discussed", "tell me about [X]", "what did we say about", "what were the [X] we discussed"
- Asks about specific technical details, products, or subjects mentioned before
- Wants information about something specific that was covered in previous exchanges
- Even if some information about the topic exists in current context, use semantic_search to get comprehensive topic-specific information

IMPORTANT: Use "date_based_search" when the user:
- Asks about conversations from specific dates or time periods
- Uses temporal references like "yesterday", "last week", "last 5 days", "this morning"
- Wants to know what was discussed on specific dates
- Requests topics or information from a particular time range
- Combines date references with topic queries (e.g., "what did we discuss about APIs yesterday?")

CONTEXT AMOUNT GUIDELINES:
- If user asks casually about a topic without requesting details: maxContextItems = 3
- If user asks for detailed/comprehensive/complete information: maxContextItems = 5-8
- If user asks for "everything" or "all information": maxContextItems = 10

GUIDELINES:
- Focus on actionable intent, not just topic identification
- Consider conversation flow and user's journey
- Identify if user is answering a previous question or asking something new
- Keep compressed context under 200 words but preserve essential information
- Extract pending questions that still need follow-up`;

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
                  enum: ["continuation", "new_topic", "clarification"],
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
                contextRetrievalStrategy: {
                  type: "string",
                  enum: [
                    "none",
                    "recent_only",
                    "semantic_search",
                    "all_available",
                    "date_based_search",
                  ],
                  description: "Strategy for retrieving historical context",
                },
                semanticSearchQueries: {
                  type: "array",
                  items: { type: "string" },
                  description: "Search queries for semantic context retrieval",
                },
                dateQuery: {
                  type: ["string", "null"],
                  description: "Temporal reference for date-based search (e.g., 'yesterday', 'last 5 days', '2025-08-05')",
                },
                includeHours: {
                  type: "boolean",
                  description: "Whether hour-level granularity is needed for date filtering",
                },
                maxContextItems: {
                  type: "integer",
                  minimum: 1,
                  maximum: 10,
                  description: "Maximum number of context items to retrieve",
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
                "contextRetrievalStrategy",
                "semanticSearchQueries",
                "dateQuery",
                "includeHours",
                "maxContextItems",
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

      // Debug logging for date-based queries
      if (analysis.contextRetrievalStrategy === "date_based_search") {
        console.log("🗓️ [DEBUG] Date-based search detected:", {
          dateQuery: analysis.dateQuery,
          includeHours: analysis.includeHours,
          maxContextItems: analysis.maxContextItems,
          currentPrompt: currentPrompt.substring(0, 100) + "...",
        });
      }

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
        contextRetrievalStrategy: analysis.contextRetrievalStrategy,
        semanticSearchQueries: analysis.semanticSearchQueries,
        maxContextItems: analysis.maxContextItems,
        dateQuery: analysis.dateQuery,
        includeHours: analysis.includeHours,
      };
    } catch (error) {
      console.error("Intent analysis failed:", error);

      // Fallback analysis
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
        contextRetrievalStrategy: "recent_only",
        semanticSearchQueries: [],
        maxContextItems: 5,
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
      contextRetrievalStrategy: "recent_only", // Default strategy
      semanticSearchQueries: [], // Default empty array
      maxContextItems: 5, // Default value
    };
  }
}
