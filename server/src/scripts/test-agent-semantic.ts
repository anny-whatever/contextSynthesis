import { PrismaClient } from '@prisma/client';
import { AgentService } from '../services/agent-service';
import { ToolRegistry } from '../tools/tool-registry';
import OpenAI from 'openai';

const prisma = new PrismaClient();

async function testAgentSemanticSearch() {
  console.log('🧪 Testing Agent Service with Semantic Search\n');

  try {
    // Initialize services
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const toolRegistry = new ToolRegistry(prisma);
    const agentService = new AgentService(openai, prisma, toolRegistry);

    // Find a conversation with summaries
    const conversationWithSummaries = await prisma.conversation.findFirst({
      include: {
        summaries: {
          select: {
            id: true,
            topicName: true,
            summaryText: true,
            relatedTopics: true,
            messageRange: true,
            summaryLevel: true,
            topicRelevance: true,
          },
        },
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 5,
        },
      },
      where: {
        summaries: {
          some: {},
        },
      },
    });

    if (!conversationWithSummaries) {
      console.log('❌ No conversation with summaries found');
      return;
    }

    console.log('📊 Found conversation with summaries:', {
      conversationId: conversationWithSummaries.id,
      summariesCount: conversationWithSummaries.summaries.length,
      recentMessagesCount: conversationWithSummaries.messages.length,
    });

    console.log('📚 Available summaries:');
    conversationWithSummaries.summaries.forEach((summary: any, index: number) => {
      console.log(`  ${index + 1}. ${summary.topicName}`);
      console.log(`     ${summary.summaryText.substring(0, 100)}...`);
    });

    // Test queries that should trigger semantic search
    const testQueries = [
      'Can you tell me about the dobsonian telescope we discussed?',
      'What did we talk about regarding technical specifications?',
      'Remind me about the telescope features we covered',
    ];

    for (const query of testQueries) {
      console.log(`\n🔍 Testing query: "${query}"`);
      
      try {
        const response = await agentService.processMessage({
          conversationId: conversationWithSummaries.id,
          message: query,
          userId: 'test-user',
        });

        console.log('✅ Agent Response:');
        console.log(`   Response Length: ${response.message.length} characters`);
        console.log(`   Tools Used: ${response.toolsUsed?.length || 0}`);
        console.log(`   Duration: ${response.metadata.duration}ms`);
        console.log(`   Model: ${response.metadata.model}`);
        console.log(`   Input Tokens: ${response.metadata.inputTokens || 'N/A'}`);
        console.log(`   Output Tokens: ${response.metadata.outputTokens || 'N/A'}`);
        console.log(`   Cost: $${response.metadata.cost || 'N/A'}`);
        
        // Show a preview of the response
        console.log(`   Response Preview: ${response.message.substring(0, 200)}...`);

        // Check if the response mentions any of the summary topics
        const mentionedTopics = conversationWithSummaries.summaries.filter((summary: any) =>
          response.message.toLowerCase().includes(summary.topicName.toLowerCase()) ||
          response.message.toLowerCase().includes('telescope') ||
          response.message.toLowerCase().includes('dobsonian')
        );

        if (mentionedTopics.length > 0) {
          console.log(`   ✅ Response mentions relevant topics: ${mentionedTopics.map((t: any) => t.topicName).join(', ')}`);
        } else {
          console.log(`   ⚠️  Response doesn't mention specific topics from summaries`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing query: ${error}`);
      }
    }

    console.log('\n🎉 Agent semantic search test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAgentSemanticSearch().catch(console.error);