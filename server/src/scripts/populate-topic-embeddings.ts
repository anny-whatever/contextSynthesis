#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { TopicEmbeddingService } from '../services/topic-embedding-service';

async function populateTopicEmbeddings() {
  const prisma = new PrismaClient();
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const embeddingService = new TopicEmbeddingService(openai, prisma);

  try {
    console.log('🚀 Starting topic embedding population...');
    
    // Check how many summaries need embeddings
    const totalSummaries = await prisma.conversationSummary.count();
    const summariesWithoutEmbeddings = await prisma.$queryRaw<{count: bigint}[]>`
      SELECT COUNT(*) as count 
      FROM conversation_summaries 
      WHERE "topicEmbedding" IS NULL
    `;
    
    const needsEmbedding = Number(summariesWithoutEmbeddings[0]?.count || 0);
    
    console.log(`📊 Summary statistics:`);
    console.log(`  - Total summaries: ${totalSummaries}`);
    console.log(`  - Need embeddings: ${needsEmbedding}`);
    console.log(`  - Already have embeddings: ${totalSummaries - needsEmbedding}`);
    
    if (needsEmbedding === 0) {
      console.log('✅ All summaries already have embeddings!');
      return;
    }

    console.log(`\n🔄 Processing ${needsEmbedding} summaries...`);
    
    // Generate embeddings in batches
    await embeddingService.generateMissingEmbeddings(10); // Smaller batch size for safety
    
    console.log('✅ Topic embedding population completed successfully!');
    
    // Verify results
    const remainingSummariesWithoutEmbeddings = await prisma.$queryRaw<{count: bigint}[]>`
      SELECT COUNT(*) as count 
      FROM conversation_summaries 
      WHERE "topicEmbedding" IS NULL
    `;
    
    const remaining = Number(remainingSummariesWithoutEmbeddings[0]?.count || 0);
    console.log(`\n📈 Final statistics:`);
    console.log(`  - Summaries processed: ${needsEmbedding - remaining}`);
    console.log(`  - Remaining without embeddings: ${remaining}`);
    
    if (remaining > 0) {
      console.log(`⚠️  ${remaining} summaries still need embeddings. You may want to run this script again.`);
    }

  } catch (error) {
    console.error('❌ Error populating topic embeddings:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if called directly
if (require.main === module) {
  populateTopicEmbeddings()
    .then(() => {
      console.log('🎉 Migration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

export { populateTopicEmbeddings };