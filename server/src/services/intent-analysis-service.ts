import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

export interface IntentAnalysisResult {
  currentIntent: string;
  contextualRelevance: 'high' | 'medium' | 'low';
  relationshipToHistory: 'continuation' | 'new_topic' | 'clarification';
  keyTopics: string[];
  pendingQuestions: string[];
  lastAssistantQuestion?: string | undefined;
  compressedContext: string;
  analysisResult: any;
}

export interface ConversationContext {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>;
  summaries: Array<{
    summaryText: string;
    keyTopics: any;
    messageRange: any;
    summaryLevel: number;
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

  private async loadConversationContext(conversationId: string): Promise<ConversationContext> {
    // Load recent messages (last 20 to have enough context)
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    // Load conversation summaries
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: {
        summaryText: true,
        keyTopics: true,
        messageRange: true,
        summaryLevel: true,
      },
    });

    // Load last intent analysis for context
    const lastIntentAnalysis = await this.prisma.intentAnalysis.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: {
        currentIntent: true,
        keyTopics: true,
        pendingQuestions: true,
        lastAssistantQuestion: true,
      },
    });

    const context: ConversationContext = {
      messages: messages.reverse(), // Reverse to get chronological order
      summaries
    };

    if (lastIntentAnalysis) {
      context.lastIntentAnalysis = {
        currentIntent: lastIntentAnalysis.currentIntent,
        keyTopics: lastIntentAnalysis.keyTopics,
        pendingQuestions: lastIntentAnalysis.pendingQuestions,
        lastAssistantQuestion: lastIntentAnalysis.lastAssistantQuestion
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

RESPONSE FORMAT (JSON):
{
  "currentIntent": "Clear description of what the user wants to achieve",
  "contextualRelevance": "high|medium|low",
  "relationshipToHistory": "continuation|new_topic|clarification",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "pendingQuestions": ["question1", "question2"],
  "lastAssistantQuestion": "Last question asked by assistant (if any)",
  "compressedContext": "Brief summary of relevant context for this intent"
}

GUIDELINES:
- Focus on actionable intent, not just topic identification
- Consider conversation flow and user's journey
- Identify if user is answering a previous question or asking something new
- Keep compressed context under 200 words but preserve essential information
- Extract pending questions that still need follow-up`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `CONVERSATION CONTEXT:\n${contextText}\n\nCURRENT USER PROMPT:\n${currentPrompt}\n\nProvide intent analysis in JSON format.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      });

      const analysisText = response.choices[0]?.message?.content;
      if (!analysisText) {
        throw new Error('No analysis response received');
      }

      // Parse JSON response
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
      };
    } catch (error) {
      console.error('Intent analysis failed:', error);
      
      // Fallback analysis
      return {
        currentIntent: 'User query requiring assistance',
        contextualRelevance: 'medium',
        relationshipToHistory: 'continuation',
        keyTopics: [],
        pendingQuestions: [],
        compressedContext: 'Context analysis unavailable',
        analysisResult: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  private buildContextText(context: ConversationContext): string {
    let contextText = '';

    // Add summaries if available
    if (context.summaries.length > 0) {
      contextText += 'CONVERSATION SUMMARIES:\n';
      context.summaries.forEach((summary, index) => {
        contextText += `Summary ${index + 1} (Level ${summary.summaryLevel}): ${summary.summaryText}\n`;
        contextText += `Key Topics: ${(summary.keyTopics as string[]).join(', ')}\n\n`;
      });
    }

    // Add recent messages
    if (context.messages.length > 0) {
      contextText += 'RECENT MESSAGES:\n';
      context.messages.forEach((message) => {
        contextText += `${message.role.toUpperCase()}: ${message.content}\n`;
      });
    }

    // Add last intent analysis context
    if (context.lastIntentAnalysis) {
      contextText += '\nLAST INTENT ANALYSIS:\n';
      contextText += `Intent: ${context.lastIntentAnalysis.currentIntent}\n`;
      contextText += `Topics: ${context.lastIntentAnalysis.keyTopics.join(', ')}\n`;
      if (context.lastIntentAnalysis.pendingQuestions.length > 0) {
        contextText += `Pending Questions: ${context.lastIntentAnalysis.pendingQuestions.join(', ')}\n`;
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

  async getLatestIntentAnalysis(conversationId: string): Promise<IntentAnalysisResult | null> {
    const analysis = await this.prisma.intentAnalysis.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) return null;

    return {
      currentIntent: analysis.currentIntent,
      contextualRelevance: analysis.contextualRelevance as 'high' | 'medium' | 'low',
      relationshipToHistory: analysis.relationshipToHistory as 'continuation' | 'new_topic' | 'clarification',
      keyTopics: analysis.keyTopics as string[],
      pendingQuestions: analysis.pendingQuestions as string[],
      lastAssistantQuestion: analysis.lastAssistantQuestion || undefined,
      compressedContext: '', // Not stored separately, would need to regenerate
      analysisResult: analysis.analysisResult,
    };
  }
}