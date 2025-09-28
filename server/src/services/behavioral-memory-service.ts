import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

export interface BehavioralMemoryUpdate {
  conversationId: string;
  updatedMemory: string;
  changes: string[];
  wordCount: number;
}

export class BehavioralMemoryService {
  private openai: OpenAI;
  private prisma: PrismaClient;

  constructor(openai?: OpenAI, prisma?: PrismaClient) {
    this.openai = openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.prisma = prisma || new PrismaClient();
  }

  /**
   * Analyzes user prompt and updates behavioral memory for the conversation
   */
  async updateBehavioralMemory(
    conversationId: string,
    userPrompt: string,
    existingMemory?: string
  ): Promise<BehavioralMemoryUpdate> {
    console.log("🧠 [BEHAVIORAL MEMORY] Updating memory for conversation:", {
      conversationId,
      promptLength: userPrompt.length,
      hasExistingMemory: !!existingMemory,
    });

    try {
      // Analyze the prompt and update memory using AI
      const updatedMemoryData = await this.analyzeAndUpdateMemory(
        userPrompt,
        existingMemory || ""
      );

      // Save to database
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          behavioralMemory: updatedMemoryData.memory,
          updatedAt: new Date(),
        },
      });

      console.log("✅ [BEHAVIORAL MEMORY] Successfully updated memory:", {
        conversationId,
        wordCount: updatedMemoryData.wordCount,
        changes: updatedMemoryData.changes.length,
      });

      return {
        conversationId,
        updatedMemory: updatedMemoryData.memory,
        changes: updatedMemoryData.changes,
        wordCount: updatedMemoryData.wordCount,
      };
    } catch (error) {
      console.error("❌ [BEHAVIORAL MEMORY] Error updating memory:", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return existing memory if update fails
      return {
        conversationId,
        updatedMemory: existingMemory || "",
        changes: [],
        wordCount: existingMemory ? existingMemory.split(" ").length : 0,
      };
    }
  }

  /**
   * Retrieves current behavioral memory for a conversation
   */
  async getBehavioralMemory(conversationId: string): Promise<string | null> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { behavioralMemory: true },
      });

      return conversation?.behavioralMemory || null;
    } catch (error) {
      console.error("❌ [BEHAVIORAL MEMORY] Error retrieving memory:", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Manually updates behavioral memory (for user edits)
   */
  async setBehavioralMemory(
    conversationId: string,
    memory: string
  ): Promise<boolean> {
    try {
      // Validate word count
      const wordCount = memory.trim().split(/\s+/).length;
      if (wordCount > 300) {
        throw new Error(`Memory too long: ${wordCount} words (max 300)`);
      }

      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          behavioralMemory: memory.trim(),
          updatedAt: new Date(),
        },
      });

      console.log("✅ [BEHAVIORAL MEMORY] Manually updated memory:", {
        conversationId,
        wordCount,
      });

      return true;
    } catch (error) {
      console.error("❌ [BEHAVIORAL MEMORY] Error setting memory:", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Uses AI to analyze prompt and intelligently update behavioral memory
   */
  private async analyzeAndUpdateMemory(
    userPrompt: string,
    existingMemory: string
  ): Promise<{ memory: string; changes: string[]; wordCount: number }> {
    const systemPrompt = `You are a behavioral memory analyst that extracts and maintains user communication preferences from their prompts.

TASK: Analyze the user's prompt and update their behavioral memory, which should capture:
- Communication style preferences (formal/casual, brief/detailed, direct/diplomatic)
- Tone preferences (professional, friendly, technical, conversational, humorous)
- Response format preferences (bullet points, explanations, examples, step-by-step)
- Technical level (beginner, intermediate, expert)
- Interaction patterns and behavioral cues

MEMORY FORMAT EXAMPLE:
"User prefers brief, direct communication with a conversational tone. Shows beginner-level technical understanding and appreciates simple explanations without excessive detail. Tends to ask for quick answers and dislikes overly formal responses."

CRITICAL RULES:
1. Keep memory between 250-300 words maximum
2. Focus ONLY on communication/behavioral patterns, NOT content details
3. Extract implicit and explicit style/tone cues from the prompt
4. Update existing memory intelligently - don't just append
5. Prioritize recent preferences over old ones
6. Remove outdated or conflicting information

EXISTING MEMORY:
${existingMemory || "No existing memory"}

USER PROMPT TO ANALYZE:
${userPrompt}

Return your response as JSON:
{
  "memory": "Updated behavioral memory as plain text (250-300 words) - NOT as structured object but as natural language",
  "changes": ["List of specific changes made"],
  "analysis": "Brief explanation of what behavioral cues were detected"
}

CRITICAL: The "memory" field must be a plain text string describing the user's behavioral patterns, NOT a structured JSON object.

If no behavioral cues are detected in the prompt, return the existing memory unchanged with empty changes array.`;

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

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("No response from OpenAI");
    }

    try {
      const parsed = JSON.parse(response);

      // Handle case where AI returns structured object instead of string
      let memoryText: string;
      if (typeof parsed.memory === "string") {
        memoryText = parsed.memory;
      } else if (typeof parsed.memory === "object") {
        console.warn(
          "⚠️ [BEHAVIORAL MEMORY] AI returned structured memory object, converting to text"
        );
        // Convert structured memory to readable natural language text
        const memoryObj = parsed.memory;
        const parts: string[] = [];

        // Extract communication style preferences
        if (memoryObj.communication_style_preferences) {
          const prefs = memoryObj.communication_style_preferences;
          const activeStyles = Object.entries(prefs)
            .filter(([_, value]) => value === true)
            .map(([key, _]) => key.replace(/_/g, " "));
          if (activeStyles.length > 0) {
            parts.push(`Communication style: ${activeStyles.join(", ")}`);
          }
        }

        // Extract tone preferences
        if (memoryObj.tone_preferences) {
          const prefs = memoryObj.tone_preferences;
          const activeTones = Object.entries(prefs)
            .filter(([_, value]) => value === true)
            .map(([key, _]) => key.replace(/_/g, " "));
          if (activeTones.length > 0) {
            parts.push(`Tone: ${activeTones.join(", ")}`);
          }
        }

        // Extract technical level
        if (memoryObj.technical_level) {
          parts.push(`Technical level: ${memoryObj.technical_level}`);
        }

        // Extract interaction patterns
        if (memoryObj.interaction_patterns) {
          const patterns = Object.entries(memoryObj.interaction_patterns)
            .filter(([_, value]) => value === true)
            .map(([key, _]) => key.replace(/_/g, " "));
          if (patterns.length > 0) {
            parts.push(`Interaction patterns: ${patterns.join(", ")}`);
          }
        }

        memoryText =
          parts.length > 0
            ? parts.join(". ") + "."
            : "No specific behavioral preferences detected";
      } else {
        throw new Error("Memory field is not a string or object");
      }

      const wordCount = memoryText.trim().split(/\s+/).length;

      // Validate word count
      if (wordCount > 300) {
        console.warn("⚠️ [BEHAVIORAL MEMORY] Memory too long, truncating:", {
          wordCount,
        });
        // Truncate to 300 words
        const words = memoryText.trim().split(/\s+/);
        memoryText = words.slice(0, 300).join(" ");
      }

      return {
        memory: memoryText.trim(),
        changes: parsed.changes || [],
        wordCount: memoryText.trim().split(/\s+/).length,
      };
    } catch (parseError) {
      console.error("❌ [BEHAVIORAL MEMORY] Failed to parse AI response:", {
        response,
        error: parseError,
      });

      // Fallback: return existing memory
      return {
        memory: existingMemory,
        changes: [],
        wordCount: existingMemory ? existingMemory.split(/\s+/).length : 0,
      };
    }
  }
}
