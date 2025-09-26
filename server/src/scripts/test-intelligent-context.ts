import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { AgentService } from '../services/agent-service';
import { SmartContextService } from '../services/smart-context-service';
import { IntentAnalysisService } from '../services/intent-analysis-service';

async function testIntelligentContext() {
  const prisma = new PrismaClient();
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    console.log('🧪 Starting Intelligent Context System Test\n');

    // Initialize services
    const agentService = new AgentService(openai, prisma);
    const intentAnalysisService = new IntentAnalysisService(prisma, openai);

    // Test scenarios with different types of queries
    const testScenarios = [
      {
        name: 'New Topic Query (should use none/recent_only strategy)',
        query: 'What is the weather like today?',
        expectedStrategy: ['none', 'recent_only'],
        expectedHistoricalContext: false,
      },
      {
        name: 'Reference to Past Meeting (should use semantic_search)',
        query: 'Can you tell me more about the meeting we discussed earlier?',
        expectedStrategy: ['semantic_search'],
        expectedHistoricalContext: true,
      },
      {
        name: 'Budget Question (should use semantic_search)',
        query: 'What was the budget allocation we talked about?',
        expectedStrategy: ['semantic_search'],
        expectedHistoricalContext: true,
      },
      {
        name: 'Technical Specifications Query (should use semantic_search)',
        query: 'What were the technical requirements mentioned before?',
        expectedStrategy: ['semantic_search'],
        expectedHistoricalContext: true,
      },
      {
        name: 'Complex Context Query (might use all_summaries)',
        query: 'Can you provide a comprehensive overview of all our previous discussions including meetings, budgets, and technical specs?',
        expectedStrategy: ['all_summaries', 'semantic_search'],
        expectedHistoricalContext: true,
      },
      {
        name: 'Simple Greeting (should use none strategy)',
        query: 'Hello, how are you?',
        expectedStrategy: ['none', 'recent_only'],
        expectedHistoricalContext: false,
      },
    ];

    // Find a conversation with existing summaries
    const conversationWithSummaries = await prisma.conversation.findFirst({
      include: {
        _count: {
          select: {
            summaries: true,
          },
        },
      },
      where: {
        summaries: {
          some: {},
        },
      },
    });

    if (!conversationWithSummaries) {
      console.log('❌ No conversations with summaries found. Please run the migration script first.');
      return;
    }

    console.log(`📋 Using conversation: ${conversationWithSummaries.id}`);
    console.log(`📊 Available summaries: ${conversationWithSummaries._count.summaries}\n`);

    // Test each scenario
    for (const scenario of testScenarios) {
      console.log(`🔍 Testing: ${scenario.name}`);
      console.log(`📝 Query: "${scenario.query}"`);

      try {
        // Create a temporary user message for intent analysis
        const tempMessage = await prisma.message.create({
          data: {
            conversationId: conversationWithSummaries.id,
            role: 'USER',
            content: scenario.query,
          },
        });

        // Perform intent analysis
        const intentAnalysis = await intentAnalysisService.analyzeIntent(
          conversationWithSummaries.id,
          tempMessage.id,
          scenario.query
        );

        console.log(`🧠 Intent Analysis Results:`);
        console.log(`   Current Intent: ${intentAnalysis.currentIntent}`);
        console.log(`   Contextual Relevance: ${intentAnalysis.contextualRelevance}`);
        console.log(`   Relationship to History: ${intentAnalysis.relationshipToHistory}`);
        console.log(`   Key Topics: ${intentAnalysis.keyTopics.join(', ')}`);
        console.log(`   Needs Historical Context: ${intentAnalysis.needsHistoricalContext}`);
        console.log(`   Context Retrieval Strategy: ${intentAnalysis.contextRetrievalStrategy}`);
        if (intentAnalysis.semanticSearchQueries) {
          console.log(`   Semantic Search Queries: ${intentAnalysis.semanticSearchQueries.join(', ')}`);
        }
        console.log(`   Max Context Items: ${intentAnalysis.maxContextItems}`);

        // Validate expectations
        const strategyMatches = scenario.expectedStrategy.includes(intentAnalysis.contextRetrievalStrategy);
        const contextNeedMatches = scenario.expectedHistoricalContext === intentAnalysis.needsHistoricalContext;

        console.log(`✅ Strategy Match: ${strategyMatches ? 'PASS' : 'FAIL'} (expected: ${scenario.expectedStrategy.join(' or ')}, got: ${intentAnalysis.contextRetrievalStrategy})`);
        console.log(`✅ Context Need Match: ${contextNeedMatches ? 'PASS' : 'FAIL'} (expected: ${scenario.expectedHistoricalContext}, got: ${intentAnalysis.needsHistoricalContext})`);

        // Clean up temporary message
        await prisma.message.delete({
          where: { id: tempMessage.id },
        });

        console.log('');
      } catch (error) {
        console.error(`❌ Error testing scenario "${scenario.name}":`, error);
        console.log('');
      }
    }

    // Test the full agent service flow with one example
    console.log('🚀 Testing Full Agent Service Flow\n');
    
    try {
      const response = await agentService.processMessage({
        conversationId: conversationWithSummaries.id,
        message: 'Can you remind me about the meeting details we discussed?',
        userId: 'test-user',
      });

      console.log('📤 Agent Response:');
      console.log(`   Message Length: ${response.message.length} characters`);
      console.log(`   Tools Used: ${response.toolsUsed?.length || 0}`);
      console.log(`   Conversation ID: ${response.conversationId}`);
      console.log(`   Model: ${response.metadata.model}`);
      console.log(`   Duration: ${response.metadata.duration}ms`);
      console.log(`   Input Tokens: ${response.metadata.inputTokens || 'N/A'}`);
      console.log(`   Output Tokens: ${response.metadata.outputTokens || 'N/A'}`);
      console.log(`   Cost: $${response.metadata.cost || 'N/A'}`);
      console.log(`   Response Preview: ${response.message.substring(0, 200)}...`);
    } catch (error) {
      console.error('❌ Error testing full agent service flow:', error);
    }

    console.log('\n🎉 Intelligent Context System Test Completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testIntelligentContext().catch(console.error);