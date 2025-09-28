import OpenAI from 'openai';
import { PrismaClient, UsageOperationType } from '@prisma/client';
import { UsageTrackingService } from './usage-tracking-service';

export class TopicEmbeddingService {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private usageTrackingService: UsageTrackingService;

  constructor(openai: OpenAI, prisma: PrismaClient, usageTrackingService?: UsageTrackingService) {
    this.openai = openai;
    this.prisma = prisma;
    this.usageTrackingService = usageTrackingService || new UsageTrackingService(prisma);
  }

  /**
   * Generate embedding for search queries (no usage tracking)
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
        dimensions: 384
      });

      return response.data[0]?.embedding || [];
    } catch (error) {
      console.error('Error generating query embedding:', error);
      throw new Error(`Failed to generate embedding for query: ${query}`);
    }
  }

  /**
   * Generate embedding for a topic name (with usage tracking)
   */
  async generateTopicEmbedding(
    topicName: string, 
    conversationId?: string, 
    messageId?: string,
    userId?: string
  ): Promise<number[]> {
    const startTime = Date.now();
    
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: topicName,
        dimensions: 384
      });

      const duration = Date.now() - startTime;
      const inputTokens = response.usage?.total_tokens || 0;

      // Track embedding usage with conversationId and messageId when available
      const usageData: any = {
        operationType: UsageOperationType.EMBEDDING_GENERATION,
        operationSubtype: 'topic_embedding',
        model: 'text-embedding-3-small',
        inputTokens: 0, // Embeddings don't have separate input/output tokens
        outputTokens: 0,
        duration,
        success: true,
        metadata: {
          topicName,
          dimensions: 384,
          totalTokens: inputTokens
        },
        embeddingUsage: {
          inputTokens,
          model: 'text-embedding-3-small'
        }
      };

      if (conversationId) usageData.conversationId = conversationId;
      if (messageId) usageData.messageId = messageId;
      if (userId) usageData.userId = userId;

      await this.usageTrackingService.trackUsage(usageData);

      return response.data[0]?.embedding || [];
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Track failed embedding usage with conversationId and messageId when available
      const errorUsageData: any = {
        operationType: UsageOperationType.EMBEDDING_GENERATION,
        operationSubtype: 'topic_embedding',
        model: 'text-embedding-3-small',
        inputTokens: 0,
        outputTokens: 0,
        duration,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          topicName,
          dimensions: 384
        }
      };

      if (conversationId) errorUsageData.conversationId = conversationId;
      if (messageId) errorUsageData.messageId = messageId;
      if (userId) errorUsageData.userId = userId;

      await this.usageTrackingService.trackUsage(errorUsageData);

      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding for topic: ${topicName}`);
    }
  }

  /**
   * Update a conversation summary with its topic embedding
   */
  async updateSummaryEmbedding(summaryId: string, messageId?: string, userId?: string): Promise<void> {
    try {
      // Get the summary with conversationId
      const summary = await this.prisma.conversationSummary.findUnique({
        where: { id: summaryId },
        select: { topicName: true, conversationId: true }
      });

      if (!summary || !summary.topicName) {
        throw new Error(`Summary not found or missing topic name: ${summaryId}`);
      }

      // Generate embedding with conversationId, messageId, and userId
      const embedding = await this.generateTopicEmbedding(
        summary.topicName, 
        summary.conversationId,
        messageId,
        userId
      );

      // Update the summary with the embedding using raw SQL
      await this.prisma.$executeRaw`
        UPDATE conversation_summaries 
        SET "topicEmbedding" = ${`[${embedding.join(',')}]`}::vector 
        WHERE id = ${summaryId}
      `;

      console.log(`Updated embedding for summary: ${summaryId}`);
    } catch (error) {
      console.error('Error updating summary embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for all summaries that don't have them
   */
  async generateMissingEmbeddings(batchSize: number = 50): Promise<void> {
    try {
      let processed = 0;
      let hasMore = true;

      while (hasMore) {
        // Get summaries without embeddings using raw SQL
        const summaries = await this.prisma.$queryRaw<{id: string, topicName: string}[]>`
          SELECT id, "topicName" 
          FROM conversation_summaries 
          WHERE "topicEmbedding" IS NULL 
          LIMIT ${batchSize}
        `;

        if (summaries.length === 0) {
          hasMore = false;
          break;
        }

        // Process batch
        for (const summary of summaries) {
          try {
            await this.updateSummaryEmbedding(summary.id);
            processed++;
            
            // Rate limiting - wait 100ms between requests
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`Failed to process summary ${summary.id}:`, error);
          }
        }

        console.log(`Processed ${processed} embeddings...`);
      }

      console.log(`Completed generating embeddings for ${processed} summaries`);
    } catch (error) {
      console.error('Error in batch embedding generation:', error);
      throw error;
    }
  }
}