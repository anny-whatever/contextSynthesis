#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { IntentAnalysisService } from '../services/intent-analysis-service';
import { SmartContextService } from '../services/smart-context-service';
import { SemanticTopicSearchTool } from '../tools/semantic-topic-search-tool';
import { TopicEmbeddingService } from '../services/topic-embedding-service';

async function testSemanticFlow() {
  const prisma = new PrismaClient();
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const embeddingService = new TopicEmbeddingService(openai, prisma);
  const semanticSearchTool = new SemanticTopicSearchTool(embeddingService, prisma);
  const intentAnalysisService = new IntentAnalysisService(prisma, openai);
  const smartContextService = new SmartContextService(prisma, semanticSearchTool);

  try {
    console.log('🔍 Testing complete semantic search flow...\n');
    
    // Find a conversation with summaries
    const conversationWithSummaries = await prisma.conversation.findFirst({
      include: {
        summaries: true
      },
      where: {
        summaries: {
          some: {}
        }
      }
    });

    if (!conversationWithSummaries || conversationWithSummaries.summaries.length === 0) {
      console.log('❌ No conversation with embedded summaries found. Please run the embedding generation first.');
      return;
    }

    console.log(`📋 Found conversation ${conversationWithSummaries.id} with ${conversationWithSummaries.summaries.length} summaries:`);
    conversationWithSummaries.summaries.forEach((summary, index) => {
      console.log(`  ${index + 1}. ${summary.topicName}`);
      console.log(`     ${summary.summaryText.substring(0, 80)}...`);
    });

    // Test scenarios that should trigger semantic search
    const testScenarios = [
      {
        query: "Can you tell me about the dobsonian telescope we talked about in the past?",
        expectedStrategy: "semantic_search",
        description: "Specific topic reference from past"
      },
      {
        query: `Tell me about ${conversationWithSummaries.summaries[0]?.topicName || 'the topic'} we discussed earlier`,
        expectedStrategy: "semantic_search", 
        description: "Reference to specific topic from summaries"
      },
      {
        query: "What did we talk about regarding technical specifications?",
        expectedStrategy: "semantic_search",
        description: "General topic search"
      }
    ];

    for (const scenario of testScenarios) {
      console.log(`\n🧪 Testing: ${scenario.description}`);
      console.log(`   Query: "${scenario.query}"`);
      
      // Create a temporary message for intent analysis
      const tempMessage = await prisma.message.create({
        data: {
          conversationId: conversationWithSummaries.id,
          role: 'USER',
          content: scenario.query,
        },
      });

      // Step 1: Intent Analysis
      console.log('\n   Step 1: Intent Analysis');
      const intentAnalysis = await intentAnalysisService.analyzeIntent(
        conversationWithSummaries.id,
        tempMessage.id,
        scenario.query
      );

      console.log(`   ✓ Strategy: ${intentAnalysis.contextRetrievalStrategy}`);
      console.log(`   ✓ Needs Historical Context: ${intentAnalysis.needsHistoricalContext}`);
      console.log(`   ✓ Key Topics: [${intentAnalysis.keyTopics.join(', ')}]`);
      console.log(`   ✓ Search Queries: [${intentAnalysis.semanticSearchQueries?.join(', ') || 'none'}]`);

      // Step 2: Smart Context Retrieval
      if (intentAnalysis.contextRetrievalStrategy === 'semantic_search') {
        console.log('\n   Step 2: Smart Context Retrieval (Semantic Search)');
        
        const smartContext = await smartContextService.retrieveContext(
          conversationWithSummaries.id,
          intentAnalysis
        );

        console.log(`   ✓ Retrieval Method: ${smartContext.retrievalMethod}`);
        console.log(`   ✓ Retrieved: ${smartContext.retrieved} summaries`);
        console.log(`   ✓ Total Available: ${smartContext.totalAvailable}`);
        
        if (smartContext.summaries.length > 0) {
          console.log('   ✓ Retrieved Summaries:');
          smartContext.summaries.forEach((summary, index) => {
            console.log(`      ${index + 1}. ${summary.topicName} (relevance: ${summary.topicRelevance?.toFixed(3)})`);
            console.log(`         ${summary.summaryText.substring(0, 60)}...`);
          });
        } else {
          console.log('   ⚠️  No summaries retrieved');
        }

        // Step 3: Verify tool usage tracking
        console.log('\n   Step 3: Checking Tool Usage Tracking');
        const toolUsages = await prisma.toolUsage.findMany({
          where: {
            messageId: tempMessage.id,
            toolName: 'SemanticTopicSearchTool'
          },
          orderBy: { createdAt: 'desc' }
        });

        console.log(`   ✓ Tool usage entries: ${toolUsages.length}`);
        if (toolUsages.length > 0) {
          toolUsages.forEach((usage, index) => {
            console.log(`      ${index + 1}. Status: ${usage.status}, Duration: ${usage.duration}ms`);
            if (usage.input) {
              const input = JSON.parse(usage.input as string);
              console.log(`         Query: "${input.query}", ConversationId: ${input.conversationId}`);
            }
          });
        }
      } else {
        console.log(`\n   ⚠️  Strategy is ${intentAnalysis.contextRetrievalStrategy}, not semantic_search`);
      }

      // Clean up temp message
      await prisma.message.delete({
        where: { id: tempMessage.id }
      });

      console.log('   ✅ Test completed\n');
    }

    console.log('🎉 All semantic search flow tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testSemanticFlow().catch(console.error);