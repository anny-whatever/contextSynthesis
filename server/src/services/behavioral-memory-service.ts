import OpenAI from "openai";
import { PrismaClient, UsageOperationType } from "@prisma/client";
import { UsageTrackingService } from "./usage-tracking-service";

export interface BehavioralMemoryUpdate {
  conversationId: string;
  updatedBehaviors: Record<string, any>;
  changes: string[];
  keyCount: number;
}

export interface BehaviorData {
  communication_style: 'formal' | 'casual' | 'mixed';
  response_detail: 'brief' | 'detailed' | 'balanced';
  tone_preference: 'professional' | 'friendly' | 'technical' | 'conversational';
  response_format: 'bullet_points' | 'explanations' | 'examples' | 'step_by_step';
  technical_level: 'beginner' | 'intermediate' | 'expert';
  interaction_style: 'direct' | 'empathetic' | 'analytical';
}

export class BehavioralMemoryService {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private usageTrackingService: UsageTrackingService;

  constructor(openai?: OpenAI, prisma?: PrismaClient) {
    this.openai = openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.prisma = prisma || new PrismaClient();
    this.usageTrackingService = new UsageTrackingService(this.prisma);
  }

  /**
   * Analyzes user prompt and updates behavioral memory for the conversation
   */
  async updateBehavioralMemory(
    conversationId: string,
    userPrompt: string,
    existingBehaviors?: Record<string, any>
  ): Promise<BehavioralMemoryUpdate> {
    console.log("🧠 [BEHAVIORAL MEMORY] Updating behaviors for conversation:", {
      conversationId,
      promptLength: userPrompt.length,
      hasExistingBehaviors: !!existingBehaviors,
    });

    try {
      // Analyze the prompt and update behaviors using AI
      const updatedBehaviorData = await this.analyzeAndUpdateBehaviors(
        userPrompt,
        existingBehaviors || {},
        conversationId
      );

      // Save to database
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          behaviors: updatedBehaviorData.behaviors,
          updatedAt: new Date(),
        },
      });

      console.log("✅ [BEHAVIORAL MEMORY] Behaviors updated successfully:", {
        conversationId,
        keyCount: updatedBehaviorData.keyCount,
        changes: updatedBehaviorData.changes.length,
      });

      return {
        conversationId,
        updatedBehaviors: updatedBehaviorData.behaviors,
        changes: updatedBehaviorData.changes,
        keyCount: updatedBehaviorData.keyCount,
      };
    } catch (error) {
      console.error("❌ [BEHAVIORAL MEMORY] Failed to update behaviors:", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return existing behaviors on error
      return {
        conversationId,
        updatedBehaviors: existingBehaviors || {},
        changes: [],
        keyCount: Object.keys(existingBehaviors || {}).length,
      };
    }
  }

  /**
   * Retrieves behavioral behaviors for a conversation
   */
  async getBehavioralBehaviors(conversationId: string): Promise<Record<string, any> | null> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { behaviors: true },
      });

      return conversation?.behaviors as Record<string, any> || null;
    } catch (error) {
      console.error("❌ [BEHAVIORAL MEMORY] Failed to retrieve behaviors:", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Manually sets behavioral behaviors for a conversation
   */
  async setBehavioralBehaviors(
    conversationId: string,
    behaviors: Record<string, any>
  ): Promise<boolean> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          behaviors: behaviors,
        },
      });

      console.log("✅ [BEHAVIORAL MEMORY] Behaviors set manually:", {
        conversationId,
        keyCount: Object.keys(behaviors).length,
      });

      return true;
    } catch (error) {
      console.error("❌ [BEHAVIORAL MEMORY] Failed to set behaviors:", {
        conversationId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Converts behavioral memory from JSON format to human-readable points format
   */
  formatBehavioralMemoryAsPoints(behaviors: Record<string, any>): string {
    if (!behaviors || Object.keys(behaviors).length === 0) {
      return "";
    }

    const behaviorDescriptions: Record<string, Record<string, string>> = {
      communication_style: {
        formal: "• Prefers formal, professional communication with proper grammar and structure",
        casual: "• Prefers casual, relaxed communication with informal language and tone",
        mixed: "• Comfortable with both formal and casual communication depending on context"
      },
      response_detail: {
        brief: "• Prefers concise, to-the-point responses without lengthy explanations",
        detailed: "• Appreciates comprehensive, thorough explanations with examples and context",
        balanced: "• Likes moderate detail - not too brief, not overly verbose"
      },
      tone_preference: {
        professional: "• Expects a professional, business-like tone in interactions",
        friendly: "• Enjoys a warm, approachable, and friendly conversational tone",
        technical: "• Prefers precise, technical language with accurate terminology",
        conversational: "• Likes natural, flowing conversation as if talking to a friend"
      },
      response_format: {
        bullet_points: "• Prefers information organized in clear bullet points and lists",
        explanations: "• Likes narrative explanations with flowing, connected thoughts",
        examples: "• Values concrete examples and practical demonstrations",
        step_by_step: "• Appreciates sequential, numbered instructions and procedures"
      },
      technical_level: {
        beginner: "• Requires simple explanations without technical jargon or complex concepts",
        intermediate: "• Comfortable with moderate technical detail and some specialized terms",
        expert: "• Can handle advanced technical concepts, complex terminology, and detailed analysis"
      },
      interaction_style: {
        direct: "• Appreciates straightforward, no-nonsense communication without fluff",
        empathetic: "• Values understanding, supportive responses that acknowledge emotions",
        analytical: "• Prefers logical, data-driven responses with reasoning and evidence"
      }
    };

    const points: string[] = [];

    Object.entries(behaviors).forEach(([key, value]) => {
      const descriptions = behaviorDescriptions[key];
      if (descriptions && descriptions[value]) {
        points.push(descriptions[value]);
      }
    });

    return points.join('\n');
  }

  /**
   * Uses AI to analyze prompt and intelligently update behavioral memory
   */
  private async analyzeAndUpdateBehaviors(
    userPrompt: string,
    existingBehaviors: Record<string, any>,
    conversationId?: string,
    userId?: string
  ): Promise<{ behaviors: Record<string, any>; changes: string[]; keyCount: number }> {
    const systemPrompt = `You are a behavioral analyst that extracts user communication preferences from prompts and stores them as key-value pairs.

TASK: Analyze the user's prompt and update their behavioral preferences using these specific keys:
- communication_style: "formal" | "casual" | "mixed"
- response_detail: "brief" | "detailed" | "balanced"  
- tone_preference: "professional" | "friendly" | "technical" | "conversational"
- response_format: "bullet_points" | "explanations" | "examples" | "step_by_step"
- technical_level: "beginner" | "intermediate" | "expert"
- interaction_style: "direct" | "empathetic" | "analytical"

EXISTING BEHAVIORS:
${JSON.stringify(existingBehaviors, null, 2)}

USER PROMPT TO ANALYZE:
${userPrompt}

Return your response as JSON:
{
  "behaviors": {
    "communication_style": "value",
    "response_detail": "value",
    "tone_preference": "value", 
    "response_format": "value",
    "technical_level": "value",
    "interaction_style": "value"
  },
  "changes": ["List of specific changes made"],
  "analysis": "Brief explanation of what behavioral cues were detected"
}

RULES:
1. Only include keys where you detect clear preferences from the prompt
2. Preserve existing values if no new preference is detected
3. Use exact values from the allowed options above
4. Focus on communication patterns, not content details

If no behavioral cues are detected, return existing behaviors unchanged with empty changes array.`;

    const startTime = Date.now();

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: "Analyze this prompt and update the behavioral memory.",
        },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const duration = Date.now() - startTime;
    const response = completion.choices[0]?.message?.content;

    // Track usage costs
    if (completion.usage && conversationId) {
      try {
        const trackingData: any = {
          conversationId,
          operationType: UsageOperationType.BEHAVIORAL_MEMORY,
          model: "gpt-4o-mini",
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens,
          duration,
          success: !!response,
          metadata: {
            existingBehaviorCount: Object.keys(existingBehaviors).length,
            userPromptLength: userPrompt.length,
          },
        };

        // Only include userId if it exists
        if (userId) {
          trackingData.userId = userId;
        }

        await this.usageTrackingService.trackUsage(trackingData);
      } catch (trackingError) {
        console.warn(
          "⚠️ [BEHAVIORAL MEMORY] Failed to track usage:",
          trackingError
        );
        // Don't fail the entire operation if tracking fails
      }
    }

    if (!response) {
      throw new Error("No response from OpenAI");
    }

    try {
      const parsed = JSON.parse(response);

      // Merge existing behaviors with new ones
      const updatedBehaviors = {
        ...existingBehaviors,
        ...(parsed.behaviors || {}),
      };

      const keyCount = Object.keys(updatedBehaviors).length;

      return {
        behaviors: updatedBehaviors,
        changes: parsed.changes || [],
        keyCount,
      };
    } catch (parseError) {
      console.error("❌ [BEHAVIORAL MEMORY] Failed to parse AI response:", {
        response,
        error: parseError,
      });

      // Fallback: return existing behaviors
      return {
        behaviors: existingBehaviors,
        changes: [],
        keyCount: Object.keys(existingBehaviors).length,
      };
    }
  }
}
