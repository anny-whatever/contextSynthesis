import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

export class TopicEmbeddingService {
  private openai: OpenAI;
  private prisma: PrismaClient;

  constructor(openai: OpenAI, prisma: PrismaClient) {
    this.openai = openai;
    this.prisma = prisma;
  }

  /**
   * Generate embedding for a topic name
   */
  async generateTopicEmbedding(topicName: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: topicName,
        dimensions: 384
      });

      return response.data[0]?.embedding || [];
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding for topic: ${topicName}`);
    }
  }

  /**
   * Update a conversation summary with its topic embedding
   */
  async updateSummaryEmbedding(summaryId: string): Promise<void> {
    try {
      // Get the summary
      const summary = await this.prisma.conversationSummary.findUnique({
        where: { id: summaryId },
        select: { topicName: true }
      });

      if (!summary || !summary.topicName) {
        throw new Error(`Summary not found or missing topic name: ${summaryId}`);
      }

      // Generate embedding
      const embedding = await this.generateTopicEmbedding(summary.topicName);

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