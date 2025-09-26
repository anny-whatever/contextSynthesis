import { OpenAI } from 'openai';
import { Message } from '@prisma/client';

export interface ExtractedTopic {
  topicName: string;
  relevanceScore: number;
  relatedTopics: string[];
  keyMessages: string[];
  summary: string;
}

export interface TopicExtractionResult {
  topics: ExtractedTopic[];
  batchId: string;
  totalMessages: number;
}

export class TopicExtractionService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async extractGranularTopics(messages: Message[]): Promise<TopicExtractionResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Prepare conversation text for analysis
    const conversationText = messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n\n');

    const systemPrompt = `You are an expert conversation analyst. Your task is to extract granular, focused topics from conversations.

IMPORTANT GUIDELINES:
1. Extract GRANULAR topics, not broad categories
2. Each topic should be specific and focused
3. Aim for 3-8 topics depending on conversation complexity
4. Topics should be actionable and meaningful
5. Avoid generic topics like "general discussion"
6. Focus on specific problems, solutions, concepts, or decisions discussed

For each topic, provide:
- topicName: Specific, descriptive name (2-6 words)
- relevanceScore: 0.0-1.0 based on how much conversation time was spent on this topic
- relatedTopics: Array of closely connected topic names
- keyMessages: Array of the most important message excerpts for this topic (max 3)
- summary: Focused summary of this specific topic (2-3 sentences)

Return a JSON object with an array of topics.`;

    const userPrompt = `Analyze this conversation and extract granular topics:

${conversationText}

Extract focused, specific topics that capture the granular details of what was discussed. Each topic should represent a distinct concept, problem, or area of focus within the conversation.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content received from OpenAI');
      }
      const result = JSON.parse(content);
      
      // Validate and clean the result
      const topics: ExtractedTopic[] = (result.topics || [])
        .filter((topic: any) => topic.topicName && topic.summary)
        .map((topic: any) => ({
          topicName: topic.topicName,
          relevanceScore: Math.max(0, Math.min(1, topic.relevanceScore || 0.5)),
          relatedTopics: Array.isArray(topic.relatedTopics) ? topic.relatedTopics : [],
          keyMessages: Array.isArray(topic.keyMessages) ? topic.keyMessages.slice(0, 3) : [],
          summary: topic.summary
        }));

      return {
        topics,
        batchId,
        totalMessages: messages.length
      };

    } catch (error) {
      console.error('Error extracting topics:', error);
      
      // Fallback: create a single generic topic
      return {
        topics: [{
          topicName: 'General Discussion',
          relevanceScore: 1.0,
          relatedTopics: [],
          keyMessages: [],
          summary: 'General conversation topics and discussion points.'
        }],
        batchId,
        totalMessages: messages.length
      };
    }
  }

  /**
   * Validates if topics are sufficiently granular
   */
  private validateTopicGranularity(topics: ExtractedTopic[]): boolean {
    const genericTopics = [
      'general discussion',
      'conversation',
      'chat',
      'discussion',
      'general',
      'misc',
      'other'
    ];

    // Check if we have too many generic topics
    const genericCount = topics.filter(topic => 
      genericTopics.some(generic => 
        topic.topicName.toLowerCase().includes(generic)
      )
    ).length;

    return genericCount <= Math.ceil(topics.length * 0.3); // Max 30% generic topics
  }

  /**
   * Merges similar topics to avoid redundancy
   */
  private mergeRelatedTopics(topics: ExtractedTopic[]): ExtractedTopic[] {
    // Simple similarity check based on topic names
    const merged: ExtractedTopic[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < topics.length; i++) {
      if (processed.has(i)) continue;

      const currentTopic = topics[i];
      if (!currentTopic) continue;
      
      const similarTopics: ExtractedTopic[] = [currentTopic];

      for (let j = i + 1; j < topics.length; j++) {
        if (processed.has(j)) continue;

        const otherTopic = topics[j];
        if (!otherTopic) continue;
        
        if (this.areTopicsSimilar(currentTopic.topicName, otherTopic.topicName)) {
          similarTopics.push(otherTopic);
          processed.add(j);
        }
      }

      // Merge similar topics
      if (similarTopics.length > 1) {
        const mergedTopic: ExtractedTopic = {
          topicName: currentTopic.topicName, // Keep the first topic name
          relevanceScore: Math.max(...similarTopics.map(t => t.relevanceScore)),
          relatedTopics: [...new Set(similarTopics.flatMap(t => t.relatedTopics))],
          keyMessages: [...new Set(similarTopics.flatMap(t => t.keyMessages))].slice(0, 3),
          summary: similarTopics.map(t => t.summary).join(' ')
        };
        merged.push(mergedTopic);
      } else {
        merged.push(currentTopic);
      }

      processed.add(i);
    }

    return merged;
  }

  private areTopicsSimilar(topic1: string, topic2: string): boolean {
    const words1 = topic1.toLowerCase().split(/\s+/);
    const words2 = topic2.toLowerCase().split(/\s+/);
    
    // Check for common words (simple similarity)
    const commonWords = words1.filter(word => words2.includes(word));
    return commonWords.length >= Math.min(words1.length, words2.length) * 0.5;
  }
}