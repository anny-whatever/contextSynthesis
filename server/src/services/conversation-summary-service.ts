import { PrismaClient, Message } from "@prisma/client";
import OpenAI from "openai";
import {
  TopicExtractionService,
  ExtractedTopic,
  TopicExtractionResult,
} from "./topic-extraction-service";

export interface TopicSummaryResult {
  id: string;
  topicName: string;
  summaryText: string;
  relatedTopics: string[];
  messageRange: {
    startMessageId: string;
    endMessageId: string;
    messageCount: number;
  };
  summaryLevel: number;
  topicRelevance: number;
  batchId: string;
}

export interface SummaryBatchResult {
  summaries: TopicSummaryResult[];
  batchId: string;
  totalTopics: number;
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
  private topicExtractionService: TopicExtractionService;
  private readonly TURN_THRESHOLD = 3; // 10 user messages = 10 turns

  constructor(prisma: PrismaClient, openai: OpenAI) {
    this.prisma = prisma;
    this.openai = openai;
    this.topicExtractionService = new TopicExtractionService();
  }

  async checkAndCreateSummary(
    conversationId: string
  ): Promise<SummaryBatchResult | null> {
    // Count user messages since last summary batch
    const lastSummaryBatch = await this.getLatestSummaryBatch(conversationId);

    let userMessagesSinceLastSummary: MessageForSummary[];

    if (lastSummaryBatch) {
      // Get messages after the last summary batch
      const lastBatchEndMessageId =
        lastSummaryBatch.summaries[lastSummaryBatch.summaries.length - 1]
          ?.messageRange.endMessageId;
      if (lastBatchEndMessageId) {
        userMessagesSinceLastSummary = await this.getUserMessagesSince(
          conversationId,
          lastBatchEndMessageId
        );
      } else {
        userMessagesSinceLastSummary = await this.getAllUserMessages(
          conversationId
        );
      }
    } else {
      // Get all user messages for this conversation
      userMessagesSinceLastSummary = await this.getAllUserMessages(
        conversationId
      );
    }

    console.log("📊 [SUMMARY-CHECK] Summary threshold check:", {
      conversationId,
      hasLastSummary: !!lastSummaryBatch,
      userMessagesSinceLastSummary: userMessagesSinceLastSummary.length,
      threshold: this.TURN_THRESHOLD,
      needsSummary: userMessagesSinceLastSummary.length >= this.TURN_THRESHOLD,
    });

    // Check if we've hit the threshold
    if (userMessagesSinceLastSummary.length >= this.TURN_THRESHOLD) {
      console.log(
        "📊 [SUMMARY-CREATE] Creating topic-based summaries for",
        userMessagesSinceLastSummary.length,
        "messages"
      );
      return await this.createTopicBasedSummaries(
        conversationId,
        userMessagesSinceLastSummary
      );
    }

    return null;
  }

  private async getLatestSummaryBatch(
    conversationId: string
  ): Promise<SummaryBatchResult | null> {
    const latestSummary = await this.prisma.conversationSummary.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });

    if (!latestSummary || !latestSummary.batchId) return null;

    const batchSummaries = await this.prisma.conversationSummary.findMany({
      where: {
        conversationId,
        batchId: latestSummary.batchId,
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      summaries: batchSummaries.map((summary) => ({
        id: summary.id,
        topicName: summary.topicName,
        summaryText: summary.summaryText,
        relatedTopics: (summary.relatedTopics as string[]) || [],
        messageRange: summary.messageRange as any,
        summaryLevel: summary.summaryLevel,
        topicRelevance: summary.topicRelevance,
        batchId: summary.batchId || "",
      })),
      batchId: latestSummary.batchId,
      totalTopics: batchSummaries.length,
    };
  }

  private async getUserMessagesSince(
    conversationId: string,
    lastMessageId: string
  ): Promise<MessageForSummary[]> {
    const lastMessage = await this.prisma.message.findUnique({
      where: { id: lastMessageId },
      select: { createdAt: true },
    });

    if (!lastMessage) return [];

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: "USER",
        createdAt: { gt: lastMessage.createdAt },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return messages;
  }

  private async getAllUserMessages(
    conversationId: string
  ): Promise<MessageForSummary[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: "USER",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return messages;
  }

  private async createTopicBasedSummaries(
    conversationId: string,
    userMessages: MessageForSummary[]
  ): Promise<SummaryBatchResult> {
    // Get all messages (user + assistant) in the range for topic extraction
    if (userMessages.length === 0) {
      throw new Error("No user messages to summarize");
    }

    const allMessages = await this.getAllMessagesInRange(
      conversationId,
      userMessages[0]!.createdAt,
      userMessages[userMessages.length - 1]!.createdAt
    );

    // Extract granular topics from the conversation
    const topicExtractionResult =
      await this.topicExtractionService.extractGranularTopics(allMessages);

    // Create summaries for each topic
    const topicSummaries: TopicSummaryResult[] = [];

    for (const topic of topicExtractionResult.topics) {
      const topicSummary = await this.createTopicSummary(
        conversationId,
        topic,
        allMessages,
        topicExtractionResult.batchId
      );
      topicSummaries.push(topicSummary);
    }

    // Store all topic summaries in the database
    await this.storeTopicSummaries(conversationId, topicSummaries, allMessages);

    console.log(
      "📊 [SUMMARY-COMPLETE] Created",
      topicSummaries.length,
      "topic-based summaries"
    );

    return {
      summaries: topicSummaries,
      batchId: topicExtractionResult.batchId,
      totalTopics: topicSummaries.length,
    };
  }

  private async getAllMessagesInRange(
    conversationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Message[]> {
    return await this.prisma.message.findMany({
      where: {
        conversationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  private async createTopicSummary(
    conversationId: string,
    topic: ExtractedTopic,
    allMessages: Message[],
    batchId: string
  ): Promise<TopicSummaryResult> {
    if (allMessages.length === 0) {
      throw new Error("No messages available for topic summary");
    }

    return {
      id: `topic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      topicName: topic.topicName,
      summaryText: topic.summary,
      relatedTopics: topic.relatedTopics,
      messageRange: {
        startMessageId: allMessages[0]!.id,
        endMessageId: allMessages[allMessages.length - 1]!.id,
        messageCount: allMessages.length,
      },
      summaryLevel: 1,
      topicRelevance: topic.relevanceScore,
      batchId,
    };
  }

  private async storeTopicSummaries(
    conversationId: string,
    summaries: TopicSummaryResult[],
    messages: Message[]
  ): Promise<void> {
    // Create all topic summaries in a transaction
    await this.prisma.$transaction(async (tx) => {
      const createdSummaries = [];

      for (const summary of summaries) {
        const createdSummary = await tx.conversationSummary.create({
          data: {
            conversationId,
            topicName: summary.topicName,
            summaryText: summary.summaryText,
            relatedTopics: summary.relatedTopics,
            messageRange: summary.messageRange,
            summaryLevel: summary.summaryLevel,
            topicRelevance: summary.topicRelevance,
            batchId: summary.batchId,
          },
        });
        createdSummaries.push(createdSummary);
      }

      // Link all messages to the first summary in the batch (for reference)
      if (createdSummaries.length > 0 && createdSummaries[0]) {
        const primarySummaryId = createdSummaries[0].id;
        await tx.message.updateMany({
          where: {
            id: { in: messages.map((m) => m.id) },
          },
          data: {
            summaryId: primarySummaryId,
          },
        });
      }
    });
  }

  async getAllSummaries(conversationId: string): Promise<TopicSummaryResult[]> {
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });

    return summaries.map((summary) => ({
      id: summary.id,
      topicName: summary.topicName,
      summaryText: summary.summaryText,
      relatedTopics: (summary.relatedTopics as string[]) || [],
      messageRange: summary.messageRange as any,
      summaryLevel: summary.summaryLevel,
      topicRelevance: summary.topicRelevance,
      batchId: summary.batchId || "",
    }));
  }

  async getMessageCountSinceLastSummary(
    conversationId: string
  ): Promise<number> {
    const lastSummary = await this.prisma.conversationSummary.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });

    if (!lastSummary) {
      // Count all user messages
      return await this.prisma.message.count({
        where: {
          conversationId,
          role: "USER",
        },
      });
    }

    const messageRange = lastSummary.messageRange as any;
    const lastMessageId = messageRange.endMessageId;

    const lastMessage = await this.prisma.message.findUnique({
      where: { id: lastMessageId },
      select: { createdAt: true },
    });

    if (!lastMessage) return 0;

    return await this.prisma.message.count({
      where: {
        conversationId,
        role: "USER",
        createdAt: { gt: lastMessage.createdAt },
      },
    });
  }
}
