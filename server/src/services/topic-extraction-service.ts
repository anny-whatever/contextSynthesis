import { OpenAI } from "openai";
import { Message, PrismaClient, UsageOperationType } from "@prisma/client";
import { UsageTrackingService } from "./usage-tracking-service";

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
  private usageTrackingService?: UsageTrackingService;

  constructor(prisma?: PrismaClient) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    if (prisma) {
      this.usageTrackingService = new UsageTrackingService(prisma);
    }
  }

  async extractGranularTopics(
    messages: Message[],
    conversationId?: string,
    userMessageId?: string,
    userId?: string
  ): Promise<TopicExtractionResult> {
    const batchId = `batch_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Prepare conversation text for analysis
    const conversationText = messages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n\n");

    const systemPrompt = `You are an expert conversation analyst. Your task is to extract granular, focused topics from conversations and create comprehensive, detailed summaries.

IMPORTANT GUIDELINES:
1. Extract GRANULAR topics, not broad categories
2. Each topic should be specific and focused
3. Aim for 3-8 topics depending on conversation complexity
4. Topics should be actionable and meaningful
5. Avoid generic topics like "general discussion"
6. Focus on specific problems, solutions, concepts, or decisions discussed

CRITICAL SUMMARY REQUIREMENTS:
Your summaries MUST be comprehensive and detailed, capturing ALL important information including:
- DATES: Any specific dates, times, deadlines, schedules, or temporal references
- EVENTS: Meetings, appointments, milestones, incidents, occurrences
- PERSONS: Names, roles, titles, relationships, contacts, stakeholders
- PERSONAL DETAILS: Personal preferences, experiences, background information, life events
- NUMBERS & STATISTICS: Quantities, percentages, measurements, costs, budgets, metrics, performance data
- SPECIFIC DETAILS: Technical specifications, exact requirements, precise descriptions
- CONTEXT: Background information, reasons, motivations, implications
- OUTCOMES: Results, decisions made, next steps, action items

For each topic, provide:
- topicName: Specific, descriptive name (2-6 words)
- relevanceScore: 0.0-1.0 based on how much conversation time was spent on this topic
- relatedTopics: Array of closely connected topic names
- keyMessages: Array of the most important message excerpts for this topic (max 3)
- summary: COMPREHENSIVE and DETAILED summary (5-10 sentences minimum) that captures ALL relevant dates, events, persons, personal details, numbers, statistics, and specific information discussed about this topic. Do NOT summarize briefly - include ALL important details, names, numbers, dates, and context.

Return a JSON object with an array of topics.`;

    const userPrompt = `Analyze this conversation and extract granular topics with comprehensive detailed summaries:

${conversationText}

Extract focused, specific topics that capture the granular details of what was discussed. Each topic should represent a distinct concept, problem, or area of focus within the conversation.

CRITICAL: For each topic's summary, you MUST include ALL specific details mentioned in the conversation:
- Extract and include ALL dates, times, deadlines, and temporal references
- Identify and include ALL person names, roles, titles, and relationships mentioned
- Capture ALL numbers, statistics, quantities, percentages, costs, budgets, and metrics
- Include ALL personal details, experiences, preferences, and background information
- Document ALL events, meetings, appointments, milestones, and incidents
- Preserve ALL technical specifications, requirements, and precise descriptions
- Include ALL context, reasons, motivations, implications, and outcomes

Do NOT create brief summaries. Create comprehensive, detailed summaries that preserve all the important information discussed for each topic.`;

    const startTime = Date.now();

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content received from OpenAI");
      }
      const result = JSON.parse(content);

      // Track usage for successful topic extraction
      if (this.usageTrackingService && conversationId && userMessageId) {
        const duration = Date.now() - startTime;
        await this.usageTrackingService.trackUsage({
          conversationId,
          messageId: userMessageId,
          operationType: UsageOperationType.TOPIC_EXTRACTION,
          model: "gpt-4o",
          duration,
          success: true,
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
          metadata: {
            messageCount: messages.length,
            topicsExtracted: result.topics?.length || 0,
            batchId,
            totalTokens: response.usage?.total_tokens,
          },
          ...(userId && { userId }),
        });
      }

      // Validate and clean the result
      const topics: ExtractedTopic[] = (result.topics || [])
        .filter((topic: any) => topic.topicName && topic.summary)
        .map((topic: any) => ({
          topicName: topic.topicName,
          relevanceScore: Math.max(0, Math.min(1, topic.relevanceScore || 0.5)),
          relatedTopics: Array.isArray(topic.relatedTopics)
            ? topic.relatedTopics
            : [],
          keyMessages: Array.isArray(topic.keyMessages)
            ? topic.keyMessages.slice(0, 3)
            : [],
          summary: topic.summary,
        }));

      return {
        topics,
        batchId,
        totalMessages: messages.length,
      };
    } catch (error) {
      console.error("Error extracting topics:", error);

      // Track usage for failed topic extraction
      if (this.usageTrackingService && conversationId && userMessageId) {
        const duration = Date.now() - startTime;
        await this.usageTrackingService.trackUsage({
          conversationId,
          messageId: userMessageId,
          operationType: UsageOperationType.TOPIC_EXTRACTION,
          model: "gpt-4o",
          duration,
          success: false,
          inputTokens: 0,
          outputTokens: 0,
          metadata: {
            messageCount: messages.length,
            error: error instanceof Error ? error.message : "Unknown error",
            batchId,
          },
          ...(userId && { userId }),
        });
      }

      // Fallback: create a single generic topic with detailed summary
      const fallbackSummary = this.createDetailedFallbackSummary(messages);
      return {
        topics: [
          {
            topicName: "General Discussion",
            relevanceScore: 1.0,
            relatedTopics: [],
            keyMessages: [],
            summary: fallbackSummary,
          },
        ],
        batchId,
        totalMessages: messages.length,
      };
    }
  }

  /**
   * Validates if topics are sufficiently granular
   */
  private validateTopicGranularity(topics: ExtractedTopic[]): boolean {
    const genericTopics = [
      "general discussion",
      "conversation",
      "chat",
      "discussion",
      "general",
      "misc",
      "other",
    ];

    // Check if we have too many generic topics
    const genericCount = topics.filter((topic) =>
      genericTopics.some((generic) =>
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

        if (
          this.areTopicsSimilar(currentTopic.topicName, otherTopic.topicName)
        ) {
          similarTopics.push(otherTopic);
          processed.add(j);
        }
      }

      // Merge similar topics
      if (similarTopics.length > 1) {
        const mergedTopic: ExtractedTopic = {
          topicName: currentTopic.topicName, // Keep the first topic name
          relevanceScore: Math.max(
            ...similarTopics.map((t) => t.relevanceScore)
          ),
          relatedTopics: [
            ...new Set(similarTopics.flatMap((t) => t.relatedTopics)),
          ],
          keyMessages: [
            ...new Set(similarTopics.flatMap((t) => t.keyMessages)),
          ].slice(0, 3),
          summary: this.mergeDetailedSummaries(
            similarTopics.map((t) => t.summary)
          ),
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
    const commonWords = words1.filter((word) => words2.includes(word));
    return commonWords.length >= Math.min(words1.length, words2.length) * 0.5;
  }

  private mergeDetailedSummaries(summaries: string[]): string {
    if (summaries.length === 1) return summaries[0] || "";

    // Extract unique information from all summaries
    const allText = summaries.join(" ");

    // Extract dates, numbers, names, and other details
    const dateMatches = [
      ...new Set(
        allText.match(
          /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi
        ) || []
      ),
    ];
    const numberMatches = [
      ...new Set(
        allText.match(/\b\d+(?:\.\d+)?(?:%|\$|€|£|USD|EUR|GBP)?\b/g) || []
      ),
    ];

    // Combine summaries while removing redundancy
    const sentences = summaries.flatMap((summary) =>
      summary.split(/[.!?]+/).filter((s) => s.trim().length > 10)
    );

    // Remove duplicate sentences (simple check)
    const uniqueSentences = sentences.filter((sentence, index) => {
      const trimmed = sentence.trim().toLowerCase();
      return (
        sentences.findIndex((s) => s.trim().toLowerCase() === trimmed) === index
      );
    });

    let mergedSummary = uniqueSentences.join(". ").trim();
    if (!mergedSummary.endsWith(".")) mergedSummary += ".";

    // Ensure important details are preserved
    if (dateMatches.length > 0) {
      mergedSummary += ` Key dates: ${dateMatches.slice(0, 5).join(", ")}.`;
    }
    if (numberMatches.length > 0) {
      mergedSummary += ` Important figures: ${numberMatches
        .slice(0, 8)
        .join(", ")}.`;
    }

    return mergedSummary;
  }

  private createDetailedFallbackSummary(messages: Message[]): string {
    // Extract key information from messages for fallback summary
    const userMessages = messages.filter((msg) => msg.role === "USER");
    const assistantMessages = messages.filter(
      (msg) => msg.role === "ASSISTANT"
    );

    // Extract dates, numbers, and names using simple regex patterns
    const allContent = messages.map((msg) => msg.content).join(" ");

    // Extract dates (various formats)
    const dateMatches =
      allContent.match(
        /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi
      ) || [];

    // Extract numbers and statistics
    const numberMatches =
      allContent.match(/\b\d+(?:\.\d+)?(?:%|\$|€|£|USD|EUR|GBP)?\b/g) || [];

    // Extract potential names (capitalized words that aren't common words)
    const commonWords = new Set([
      "The",
      "This",
      "That",
      "And",
      "Or",
      "But",
      "For",
      "With",
      "By",
      "From",
      "To",
      "In",
      "On",
      "At",
      "As",
      "Is",
      "Are",
      "Was",
      "Were",
      "Be",
      "Been",
      "Being",
      "Have",
      "Has",
      "Had",
      "Do",
      "Does",
      "Did",
      "Will",
      "Would",
      "Could",
      "Should",
      "May",
      "Might",
      "Can",
      "Must",
    ]);
    const nameMatches =
      allContent
        .match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g)
        ?.filter((match) => !commonWords.has(match)) || [];

    let summary = `Conversation involving ${userMessages.length} user messages and ${assistantMessages.length} assistant responses. `;

    if (dateMatches.length > 0) {
      summary += `Key dates mentioned: ${[...new Set(dateMatches)]
        .slice(0, 5)
        .join(", ")}. `;
    }

    if (nameMatches.length > 0) {
      summary += `Persons/entities referenced: ${[...new Set(nameMatches)]
        .slice(0, 10)
        .join(", ")}. `;
    }

    if (numberMatches.length > 0) {
      summary += `Important numbers/statistics: ${[...new Set(numberMatches)]
        .slice(0, 10)
        .join(", ")}. `;
    }

    // Add message content summary
    const firstUserMessage = userMessages[0]?.content || "";
    const lastUserMessage =
      userMessages[userMessages.length - 1]?.content || "";

    if (firstUserMessage) {
      summary += `Initial topic: ${firstUserMessage}. `;
    }

    if (lastUserMessage && lastUserMessage !== firstUserMessage) {
      summary += `Recent topic: ${lastUserMessage}. `;
    }

    return summary.trim();
  }
}
