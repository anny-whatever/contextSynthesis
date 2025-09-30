import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { UsageTrackingService } from './usage-tracking-service';

export interface MemoryExtraction {
  category: 'people' | 'places' | 'events' | 'life_events' | 'things';
  keyValuePairs: Record<string, string>;
  confidence: number;
}

export interface MemoryItem {
  category: 'people' | 'places' | 'events' | 'life_events' | 'things';
  key: string;
  value: string;
  confidence: number;
}

export interface MemoryUpdate {
  category: 'people' | 'places' | 'events' | 'life_events' | 'things';
  keyValuePairs: Record<string, string>;
}

export class MemoryService {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private usageTracking: UsageTrackingService;

  constructor(
    prisma: PrismaClient,
    openai: OpenAI,
    usageTracking: UsageTrackingService
  ) {
    this.prisma = prisma;
    this.openai = openai;
    this.usageTracking = usageTracking;
  }

  async extractAndStoreMemories(
    conversationId: string,
    userId: string | null,
    userPrompt: string,
    aiResponse: string
  ): Promise<MemoryExtraction[]> {
    try {
      const existingMemories = await this.getMemoriesByConversation(conversationId);
      const extractions = await this.analyzeAndExtractMemories(
        userPrompt,
        aiResponse,
        existingMemories
      );

      if (extractions.length > 0) {
        await this.storeMemories(conversationId, userId, extractions);
      }

      return extractions;
    } catch (error) {
      console.error('Error extracting and storing memories:', error);
      return [];
    }
  }

  async getMemoriesByConversation(conversationId: string): Promise<Record<string, Record<string, string>>> {
    try {
      const memories = await this.prisma.memory.findMany({
        where: { conversationId },
        orderBy: { lastUpdated: 'desc' }
      });

      const result: Record<string, Record<string, string>> = {};
      
      memories.forEach(memory => {
        if (!result[memory.category]) {
          result[memory.category] = {};
        }
        
        const keyValuePairs = memory.keyValuePairs as Record<string, string> || {};
        Object.assign(result[memory.category]!, keyValuePairs);
      });

      return result;
    } catch (error) {
      console.error('Error getting memories by conversation:', error);
      return {};
    }
  }

  async getMemoriesByUser(userId: string): Promise<Record<string, Record<string, string>>> {
    try {
      const memories = await this.prisma.memory.findMany({
        where: { userId },
        orderBy: { lastUpdated: 'desc' }
      });

      const result: Record<string, Record<string, string>> = {};
      
      memories.forEach(memory => {
        if (!result[memory.category]) {
          result[memory.category] = {};
        }
        
        const keyValuePairs = memory.keyValuePairs as Record<string, string> || {};
        Object.assign(result[memory.category]!, keyValuePairs);
      });

      return result;
    } catch (error) {
      console.error('Error getting memories by user:', error);
      return {};
    }
  }

  async updateMemoryCategory(
    conversationId: string,
    category: string,
    keyValuePairs: Record<string, string>
  ): Promise<void> {
    try {
      const existingMemory = await this.prisma.memory.findFirst({
        where: {
          conversationId,
          category
        }
      });

      if (existingMemory) {
        const currentPairs = existingMemory.keyValuePairs as Record<string, string>;
        const updatedPairs = { ...currentPairs, ...keyValuePairs };

        await this.prisma.memory.update({
          where: { id: existingMemory.id },
          data: {
            keyValuePairs: updatedPairs,
            lastUpdated: new Date()
          }
        });
      } else {
        const conversation = await this.prisma.conversation.findUnique({
          where: { id: conversationId }
        });

        await this.prisma.memory.create({
          data: {
            conversationId,
            userId: conversation?.userId || null,
            category,
            keyValuePairs,
            confidenceScore: 1.0
          }
        });
      }
    } catch (error) {
      console.error('Error updating memory category:', error);
    }
  }

  async deleteMemoryKey(
    conversationId: string,
    category: string,
    key: string
  ): Promise<void> {
    try {
      const memory = await this.prisma.memory.findFirst({
        where: {
          conversationId,
          category
        }
      });

      if (memory) {
        const keyValuePairs = memory.keyValuePairs as Record<string, string>;
        delete keyValuePairs[key];

        if (Object.keys(keyValuePairs).length === 0) {
          await this.prisma.memory.delete({
            where: { id: memory.id }
          });
        } else {
          await this.prisma.memory.update({
            where: { id: memory.id },
            data: {
              keyValuePairs,
              lastUpdated: new Date()
            }
          });
        }
      }
    } catch (error) {
      console.error('Error deleting memory key:', error);
    }
  }

  async getMemoriesForPrompt(conversationId: string): Promise<string> {
    try {
      const memories = await this.getMemoriesByConversation(conversationId);
      
      if (Object.keys(memories).length === 0) {
        return '';
      }

      let memoryText = '\n\n## User Memories\n';
      
      Object.entries(memories).forEach(([category, keyValuePairs]) => {
        if (Object.keys(keyValuePairs).length > 0) {
          memoryText += `\n### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
          Object.entries(keyValuePairs).forEach(([key, value]) => {
            memoryText += `- ${key}: ${value}\n`;
          });
        }
      });

      return memoryText;
    } catch (error) {
      console.error('Error getting memories for prompt:', error);
      return '';
    }
  }

  private async analyzeAndExtractMemories(
    userPrompt: string,
    aiResponse: string,
    existingMemories: Record<string, Record<string, string>>
  ): Promise<MemoryExtraction[]> {
    try {
      const systemPrompt = `You are a memory extraction AI. Analyze the conversation and extract factual information about the user that should be remembered for future interactions.

CATEGORIES:
- people: Names, relationships, family members, colleagues, friends
- places: Locations, addresses, cities, countries, workplaces
- events: Important dates, meetings, appointments, milestones
- life_events: Major life changes, achievements, personal history
- things: Preferences, possessions, interests, hobbies, skills

RULES:
1. Only extract factual, specific information
2. Avoid assumptions or interpretations
3. Focus on information that would be useful in future conversations
4. Each key should be descriptive and unique
5. Values should be concise but informative
6. Confidence should be 0.1-1.0 based on certainty

EXISTING MEMORIES:
${JSON.stringify(existingMemories, null, 2)}

Return a JSON array of memory extractions. Each extraction should have:
{
  "category": "people|places|events|life_events|things",
  "keyValuePairs": {"key1": "value1", "key2": "value2"},
  "confidence": 0.8
}

If no new memories should be extracted, return an empty array.`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User: ${userPrompt}\n\nAssistant: ${aiResponse}` }
        ],
        temperature: 0.1,
        max_tokens: 1000
      });

      await this.usageTracking.trackUsage({
        operationType: 'MEMORY_EXTRACTION',
        model: 'gpt-4o-mini',
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
        success: true,
        metadata: {
          existingMemoryCount: Object.keys(existingMemories).length
        }
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) return [];

      try {
        const extractions = JSON.parse(content) as MemoryExtraction[];
        return Array.isArray(extractions) ? extractions : [];
      } catch (parseError) {
        console.error('Error parsing memory extraction response:', parseError);
        return [];
      }
    } catch (error) {
      console.error('Error analyzing and extracting memories:', error);
      return [];
    }
  }

  private async storeMemories(
    conversationId: string,
    userId: string | null,
    extractions: MemoryExtraction[]
  ): Promise<void> {
    try {
      for (const extraction of extractions) {
        await this.updateMemoryCategory(
          conversationId,
          extraction.category,
          extraction.keyValuePairs
        );
      }
    } catch (error) {
      console.error('Error storing memories:', error);
    }
  }
}