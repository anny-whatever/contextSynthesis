import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

export interface SummaryResult {
  summaryText: string;
  keyTopics: string[];
  messageRange: {
    startMessageId: string;
    endMessageId: string;
    messageCount: number;
  };
  summaryLevel: number;
}

export interface MessageForSummary {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

export class ConversationSummaryService {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private readonly TURN_THRESHOLD = 10; // 10 user messages = 10 turns

  constructor(prisma: PrismaClient, openai: OpenAI) {
    this.prisma = prisma;
    this.openai = openai;
  }

  async checkAndCreateSummary(conversationId: string): Promise<SummaryResult | null> {
    // Count user messages since last summary
    const lastSummary = await this.getLatestSummary(conversationId);
    
    let userMessagesSinceLastSummary: MessageForSummary[];
    
    if (lastSummary) {
      // Get messages after the last summary
      const lastSummaryEndMessageId = lastSummary.messageRange.endMessageId;
      userMessagesSinceLastSummary = await this.getUserMessagesSince(conversationId, lastSummaryEndMessageId);
    } else {
      // Get all user messages for this conversation
      userMessagesSinceLastSummary = await this.getAllUserMessages(conversationId);
    }

    // Check if we've hit the threshold
    if (userMessagesSinceLastSummary.length >= this.TURN_THRESHOLD) {
      return await this.createSummary(conversationId, userMessagesSinceLastSummary, lastSummary);
    }

    return null;
  }

  private async getLatestSummary(conversationId: string): Promise<SummaryResult | null> {
    const summary = await this.prisma.conversationSummary.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!summary) return null;

    return {
      summaryText: summary.summaryText,
      keyTopics: summary.keyTopics as string[],
      messageRange: summary.messageRange as any,
      summaryLevel: summary.summaryLevel,
    };
  }

  private async getUserMessagesSince(conversationId: string, lastMessageId: string): Promise<MessageForSummary[]> {
    const lastMessage = await this.prisma.message.findUnique({
      where: { id: lastMessageId },
      select: { createdAt: true },
    });

    if (!lastMessage) return [];

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: 'USER',
        createdAt: { gt: lastMessage.createdAt },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return messages;
  }

  private async getAllUserMessages(conversationId: string): Promise<MessageForSummary[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: 'USER',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return messages;
  }

  private async createSummary(
    conversationId: string,
    userMessages: MessageForSummary[],
    lastSummary: SummaryResult | null
  ): Promise<SummaryResult> {
    if (userMessages.length === 0) {
      throw new Error('No messages to summarize');
    }

    // Get all messages (user + assistant) in the range to summarize
    const startDate = userMessages[0]!.createdAt;
    const endDate = userMessages[userMessages.length - 1]!.createdAt;

    const allMessagesInRange = await this.prisma.message.findMany({
      where: {
        conversationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    // Generate summary using OpenAI
    const summary = await this.generateSummary(allMessagesInRange, lastSummary);

    // Store the summary
    await this.storeSummary(conversationId, summary, allMessagesInRange);

    return summary;
  }

  private async generateSummary(
    messages: MessageForSummary[],
    lastSummary: SummaryResult | null
  ): Promise<SummaryResult> {
    if (messages.length === 0) {
      throw new Error('No messages to generate summary');
    }
    const conversationText = messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    let systemPrompt = `You are an expert conversation summarizer. Your task is to create a comprehensive yet concise summary of the conversation that preserves all important context, decisions, and information while being significantly shorter than the original.

SUMMARIZATION RULES:
1. Preserve all key information, decisions, and context
2. Maintain the logical flow and progression of topics
3. Include specific details that might be referenced later
4. Extract key topics discussed
5. Keep the summary comprehensive but concise
6. Focus on actionable information and conclusions

RESPONSE FORMAT (JSON):
{
  "summaryText": "Comprehensive summary preserving all key context and information",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "summaryLevel": 1
}

GUIDELINES:
- Summary should be 70-80% shorter than original while preserving context
- Include specific technical details, decisions made, and conclusions reached
- Maintain chronological flow of important events
- Extract 3-7 key topics that were discussed`;

    if (lastSummary) {
      systemPrompt += `\n\nPREVIOUS SUMMARY CONTEXT:\nLevel ${lastSummary.summaryLevel} Summary: ${lastSummary.summaryText}\nPrevious Topics: ${lastSummary.keyTopics.join(', ')}\n\nThis new summary should build upon the previous context.`;
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `CONVERSATION TO SUMMARIZE:\n${conversationText}\n\nProvide a comprehensive summary in JSON format.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      });

      const summaryText = response.choices[0]?.message?.content;
      if (!summaryText) {
        throw new Error('No summary response received');
      }

      const summaryData = JSON.parse(summaryText);
      
      if (messages.length === 0) {
        throw new Error('No messages to create summary range');
      }

      return {
        summaryText: summaryData.summaryText,
        keyTopics: summaryData.keyTopics || [],
        messageRange: {
          startMessageId: messages[0]!.id,
          endMessageId: messages[messages.length - 1]!.id,
          messageCount: messages.length,
        },
        summaryLevel: lastSummary ? lastSummary.summaryLevel + 1 : 1,
      };
    } catch (error) {
      console.error('Summary generation failed:', error);
      
      // Fallback summary
      if (messages.length === 0) {
        throw new Error('Cannot create fallback summary with no messages');
      }

      return {
        summaryText: `Conversation summary (${messages.length} messages): Discussion covering various topics. Summary generation failed, but conversation context preserved.`,
        keyTopics: ['general_discussion'],
        messageRange: {
          startMessageId: messages[0]!.id,
          endMessageId: messages[messages.length - 1]!.id,
          messageCount: messages.length,
        },
        summaryLevel: lastSummary ? lastSummary.summaryLevel + 1 : 1,
      };
    }
  }

  private async storeSummary(
    conversationId: string,
    summary: SummaryResult,
    messages: MessageForSummary[]
  ): Promise<void> {
    // Create the summary first
    const createdSummary = await this.prisma.conversationSummary.create({
      data: {
        conversationId,
        summaryText: summary.summaryText,
        keyTopics: summary.keyTopics,
        messageRange: summary.messageRange,
        summaryLevel: summary.summaryLevel,
      },
    });

    // Update all messages in the range to point to this summary
    if (messages.length > 0) {
      const startDate = messages[0]!.createdAt;
      const endDate = messages[messages.length - 1]!.createdAt;

      await this.prisma.message.updateMany({
        where: {
          conversationId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          summaryId: null, // Only update messages that don't already have a summaryId
        },
        data: {
          summaryId: createdSummary.id,
        },
      });

      console.log(`📝 [SUMMARY] Linked ${messages.length} messages to summary ${createdSummary.id}`);
    }
  }

  async getAllSummaries(conversationId: string): Promise<SummaryResult[]> {
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    return summaries.map(summary => ({
      summaryText: summary.summaryText,
      keyTopics: summary.keyTopics as string[],
      messageRange: summary.messageRange as any,
      summaryLevel: summary.summaryLevel,
    }));
  }

  async getMessageCountSinceLastSummary(conversationId: string): Promise<number> {
    const lastSummary = await this.getLatestSummary(conversationId);
    
    if (lastSummary) {
      const userMessages = await this.getUserMessagesSince(conversationId, lastSummary.messageRange.endMessageId);
      return userMessages.length;
    } else {
      const userMessages = await this.getAllUserMessages(conversationId);
      return userMessages.length;
    }
  }
}