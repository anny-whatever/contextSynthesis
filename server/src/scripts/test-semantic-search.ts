#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { TopicEmbeddingService } from '../services/topic-embedding-service';
import { SemanticTopicSearchTool } from '../tools/semantic-topic-search-tool';

async function testSemanticSearch() {
  const prisma = new PrismaClient();
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const embeddingService = new TopicEmbeddingService(openai, prisma);
  const searchTool = new SemanticTopicSearchTool(embeddingService, prisma);

  try {
    console.log('🔍 Testing semantic topic search...');
    
    // First, let's see what topics we have
    const allSummaries = await prisma.conversationSummary.findMany({
      select: {
        id: true,
        topicName: true,
        summaryText: true
      }
    });
    
    console.log('\n📋 Available topics:');
    allSummaries.forEach((summary, index) => {
      console.log(`  ${index + 1}. ${summary.topicName}`);
      console.log(`     Summary: ${summary.summaryText.substring(0, 100)}...`);
    });

    // Test searches with relevant queries
    const testQueries = [
      'meeting',
      'budget',
      'performance',
      'technical requirements',
      'project specifications',
      'marketing metrics',
      'John Smith',
      'RAM memory'
    ];

    for (const query of testQueries) {
      console.log(`\n🔍 Searching for: "${query}"`);
      
      const result = await searchTool.execute({
        query,
        limit: 3,
        threshold: 0.3  // Lower threshold to see more results
      });

      if (result.success && result.data) {
        console.log(`  Found ${result.data.results.length} results:`);
        result.data.results.forEach((item: any, index: number) => {
          console.log(`    ${index + 1}. ${item.topicName} (similarity: ${item.similarity})`);
          console.log(`       ${item.summaryText.substring(0, 80)}...`);
        });
      } else {
        console.log(`  Error: ${result.error}`);
      }
    }

    console.log('\n✅ Semantic search test completed!');

  } catch (error) {
    console.error('❌ Error testing semantic search:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if called directly
if (require.main === module) {
  testSemanticSearch()
    .then(() => {
      console.log('🎉 Test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

export { testSemanticSearch };