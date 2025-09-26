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
    | "all_available";
  semanticSearchQueries?: string[];
  maxContextItems?: number;
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
    // Load conversation context
    const context = await this.loadConversationContext(conversationId);

    // Perform intent analysis
    const analysis = await this.performIntentAnalysis(context, currentPrompt);

    // Store the analysis result
    await this.storeIntentAnalysis(conversationId, userMessageId, analysis);

    return analysis;
  }

  private async loadConversationContext(
    conversationId: string
  ): Promise<ConversationContext> {
    // Load recent messages (last 20 to have enough context) but only non-summarized ones
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        summaryId: null, // Only get messages that haven't been summarized
      },
      orderBy: { createdAt: "desc" },
      take: 20,
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

    // Transform only the non-summarized messages (no fake summary content)
    const transformedMessages = messages.reverse().map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content, // Use actual content since these are not summarized
      createdAt: msg.createdAt,
      isSummary: false, // These are never summaries since we filtered them out
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
  "contextRetrievalStrategy": "none|recent_only|semantic_search|all_available",
  "semanticSearchQueries": ["query1", "query2"] (always provide, empty array if not semantic_search),
  "maxContextItems": 3-10 (recommended number of context items to retrieve)
}

CONTEXT RETRIEVAL GUIDELINES:
- needsHistoricalContext: true if the query references past topics, needs background, or builds on previous discussion
- contextRetrievalStrategy:
  * "none": For simple greetings, basic questions that don't need history
  * "recent_only": For queries that only need the last few exchanges
  * "semantic_search": For queries about specific topics that might be scattered throughout history
  * "all_available": For complex queries needing comprehensive context
- semanticSearchQueries: Generate 1-3 specific search terms if using semantic_search strategy, empty array otherwise
- maxContextItems: Suggest 3-5 for simple queries, 5-8 for complex ones, up to 10 for comprehensive analysis

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
                  ],
                  description: "Strategy for retrieving historical context",
                },
                semanticSearchQueries: {
                  type: "array",
                  items: { type: "string" },
                  description: "Search queries for semantic context retrieval",
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
