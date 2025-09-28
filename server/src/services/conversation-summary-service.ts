import { PrismaClient, Message } from "@prisma/client";
import OpenAI from "openai";
import {
  TopicExtractionService,
  ExtractedTopic,
  TopicExtractionResult,
} from "./topic-extraction-service";
import { TopicEmbeddingService } from "./topic-embedding-service";
import { UsageTrackingService } from "./usage-tracking-service";

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
  sourceContext?: string;
  pointIndex?: number;
  parentTopic?: string;
  structuredContent?: boolean;
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
  private topicEmbeddingService: TopicEmbeddingService;
  private readonly TURN_THRESHOLD = 3; // 10 user messages = 10 turns

  constructor(
    prisma: PrismaClient,
    openai: OpenAI,
    topicEmbeddingService?: TopicEmbeddingService
  ) {
    this.prisma = prisma;
    this.openai = openai;
    this.topicExtractionService = new TopicExtractionService(prisma);
    this.topicEmbeddingService =
      topicEmbeddingService || new TopicEmbeddingService(openai, prisma, new UsageTrackingService(prisma));
  }

  async checkAndCreateSummary(
    conversationId: string,
    userMessageId?: string,
    userId?: string
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
        userMessagesSinceLastSummary,
        userMessageId,
        userId
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
    userMessages: MessageForSummary[],
    userMessageId?: string,
    userId?: string
  ): Promise<SummaryBatchResult> {
    // Get all messages (user + assistant) in the range for topic extraction
    if (userMessages.length === 0) {
      throw new Error("No user messages to summarize");
    }

    // Use current timestamp as endDate to include the latest assistant response
    // that was just saved to the database
    const allMessages = await this.getAllMessagesInRange(
      conversationId,
      userMessages[0]!.createdAt,
      new Date() // Use current timestamp to include the latest assistant message
    );

    // Debug: Check message content before topic extraction
    console.log("🔍 [DEBUG] Messages for topic extraction:", {
      totalMessages: allMessages.length,
      userMessagesCount: userMessages.length,
      expectedMinMessages: userMessages.length * 2, // Each user message should have an assistant response
      dateRange: {
        startDate: userMessages[0]!.createdAt.toISOString(),
        endDate: new Date().toISOString(),
        lastUserMessageDate:
          userMessages[userMessages.length - 1]!.createdAt.toISOString(),
      },
      messageRoles: allMessages.map((msg) => msg.role),
      lastMessage:
        allMessages.length > 0
          ? {
              id: allMessages[allMessages.length - 1]!.id,
              role: allMessages[allMessages.length - 1]!.role,
              createdAt:
                allMessages[allMessages.length - 1]!.createdAt.toISOString(),
              content: allMessages[allMessages.length - 1]!.content, // Show full content
            }
          : null,
      messageContentCheck: allMessages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        hasContent: !!msg.content,
        contentLength: msg.content?.length || 0,
        createdAt: msg.createdAt.toISOString(),
        content: msg.content, // Show full content
      })),
    });

    // Extract granular topics from the conversation
    const topicExtractionResult =
      await this.topicExtractionService.extractGranularTopics(
        allMessages,
        conversationId,
        userMessageId,
        userId
      );

    // Debug: Check topic extraction result
    console.log("🔍 [DEBUG] Topic extraction result:", {
      batchId: topicExtractionResult.batchId,
      topicsCount: topicExtractionResult.topics.length,
      topics: topicExtractionResult.topics.map((topic) => ({
        topicName: topic.topicName,
        hasRelatedTopics: Array.isArray(topic.relatedTopics),
        relatedTopicsCount: topic.relatedTopics?.length || 0,
        relatedTopics: topic.relatedTopics,
        hasSummary: !!topic.summary,
      })),
    });

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

    // Debug: Check topic data before creating summary
    console.log("🔍 [DEBUG] Creating topic summary:", {
      topicName: topic.topicName,
      hasRelatedTopics: Array.isArray(topic.relatedTopics),
      relatedTopicsValue: topic.relatedTopics,
      relatedTopicsType: typeof topic.relatedTopics,
      hasSummary: !!topic.summary,
      relevanceScore: topic.relevanceScore,
    });

    // Ensure relatedTopics is always an array
    const safeRelatedTopics = Array.isArray(topic.relatedTopics)
      ? topic.relatedTopics
      : [];

    const result: TopicSummaryResult = {
      id: `topic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      topicName: topic.topicName,
      summaryText: topic.summary,
      relatedTopics: safeRelatedTopics,
      messageRange: {
        startMessageId: allMessages[0]!.id,
        endMessageId: allMessages[allMessages.length - 1]!.id,
        messageCount: allMessages.length,
      },
      summaryLevel: 1,
      topicRelevance: topic.relevanceScore,
      batchId,
    };

    // Add optional fields only if they exist
    if (topic.sourceContext !== undefined) {
      result.sourceContext = topic.sourceContext;
    }
    if (topic.pointIndex !== undefined) {
      result.pointIndex = topic.pointIndex;
    }
    if (topic.parentTopic !== undefined) {
      result.parentTopic = topic.parentTopic;
    }
    if (topic.structuredContent !== undefined) {
      result.structuredContent = topic.structuredContent;
    }

    return result;
  }

  private async storeTopicSummaries(
    conversationId: string,
    summaries: TopicSummaryResult[],
    messages: Message[]
  ): Promise<void> {
    // Create all topic summaries in a transaction
    const createdSummaries = await this.prisma.$transaction(async (tx) => {
      const createdSummaries = [];

      for (const summary of summaries) {
        const createData: any = {
          conversationId,
          topicName: summary.topicName,
          summaryText: summary.summaryText,
          relatedTopics: summary.relatedTopics,
          messageRange: summary.messageRange,
          summaryLevel: summary.summaryLevel,
          topicRelevance: summary.topicRelevance,
          batchId: summary.batchId,
          structuredContent: summary.structuredContent || false,
        };

        // Add optional fields only if they exist
        if (summary.sourceContext !== undefined) {
          createData.sourceContext = summary.sourceContext;
        }
        if (summary.pointIndex !== undefined) {
          createData.pointIndex = summary.pointIndex;
        }
        if (summary.parentTopic !== undefined) {
          createData.parentTopic = summary.parentTopic;
        }

        const createdSummary = await tx.conversationSummary.create({
          data: createData,
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

      return createdSummaries;
    });

    // Generate embeddings for all created summaries immediately after transaction
    console.log(
      `🔄 [EMBEDDING] Generating embeddings for ${createdSummaries.length} summaries...`
    );

    for (const createdSummary of createdSummaries) {
      try {
        await this.topicEmbeddingService.updateSummaryEmbedding(
          createdSummary.id
        );
        console.log(
          `✅ [EMBEDDING] Generated embedding for summary: ${createdSummary.id} (${createdSummary.topicName})`
        );
      } catch (error) {
        console.error(
          `❌ [EMBEDDING] Failed to generate embedding for summary ${createdSummary.id}:`,
          error
        );
        // Don't throw here - we want to continue with other embeddings even if one fails
      }
    }

    console.log(`🎯 [EMBEDDING] Completed embedding generation for batch`);
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
