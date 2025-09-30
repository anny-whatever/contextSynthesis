import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { UsageTrackingService } from "./usage-tracking-service";
import { CharacterResearchService } from "./character-research-service";
import { CharacterKnowledgeService } from "./character-knowledge-service";

export interface RoleplayEnhancement {
  baseRole: string;
  enhancedInstructions: string | object;
  confidence: number;
  isSpecificCharacter?: boolean;
  characterKnowledgeId?: string;
}

export interface RoleplayUpdate {
  baseRole: string;
  enhancedInstructions?: string;
  isActive: boolean;
}

export class RoleplayService {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private usageTracking: UsageTrackingService;
  private characterResearch: CharacterResearchService;
  private characterKnowledge: CharacterKnowledgeService;

  constructor(
    prisma: PrismaClient,
    openai: OpenAI,
    usageTracking: UsageTrackingService
  ) {
    this.prisma = prisma;
    this.openai = openai;
    this.usageTracking = usageTracking;
    this.characterResearch = new CharacterResearchService(
      prisma,
      usageTracking
    );
    this.characterKnowledge = new CharacterKnowledgeService(
      prisma,
      openai,
      usageTracking
    );
  }

  async enhanceAndStoreRoleplay(
    conversationId: string,
    userId: string | null,
    baseRole: string,
    conversationContext: string,
    webSearchTool?: any
  ): Promise<RoleplayEnhancement | null> {
    try {
      console.log(`🎭 [ROLEPLAY] Enhancing roleplay for: ${baseRole}`);

      // Detect if this is a specific character
      const detection = await this.characterResearch.detectSpecificCharacter(
        baseRole,
        conversationContext
      );

      console.log(`🎭 [ROLEPLAY] Character detection:`, detection);

      // If specific character detected, do full research and knowledge graph
      if (detection.isSpecificCharacter && detection.characterName) {
        return await this.handleSpecificCharacterRoleplay(
          conversationId,
          userId,
          baseRole,
          detection.characterName,
          detection.characterSource,
          webSearchTool
        );
      }

      // Otherwise, use basic roleplay enhancement
      const existingRoleplay = await this.getActiveRoleplay(conversationId);

      const enhancement = await this.analyzeAndEnhanceRole(
        baseRole,
        conversationContext,
        existingRoleplay?.enhancedInstructions
      );

      if (enhancement) {
        await this.storeRoleplay(conversationId, userId, enhancement);
      }

      return enhancement;
    } catch (error) {
      console.error("Error enhancing and storing roleplay:", error);
      return null;
    }
  }

  /**
   * Handle specific character roleplay with research and knowledge graph
   */
  private async handleSpecificCharacterRoleplay(
    conversationId: string,
    userId: string | null,
    baseRole: string,
    characterName: string,
    characterSource: string | undefined,
    webSearchTool?: any
  ): Promise<RoleplayEnhancement | null> {
    try {
      console.log(
        `🔬 [ROLEPLAY] Researching specific character: ${characterName}`
      );

      // Research the character
      const researchData = await this.characterResearch.researchCharacter(
        characterName,
        characterSource,
        webSearchTool
      );

      if (!researchData) {
        console.warn(
          "⚠️ [ROLEPLAY] Character research failed, falling back to basic enhancement"
        );
        return await this.analyzeAndEnhanceRole(baseRole, "", null);
      }

      // Build and store knowledge graph
      const characterKnowledgeId =
        await this.characterKnowledge.buildAndStoreKnowledgeGraph(
          conversationId,
          characterName,
          characterSource || "Unknown",
          researchData
        );

      if (!characterKnowledgeId) {
        console.warn("⚠️ [ROLEPLAY] Failed to build knowledge graph");
        return null;
      }

      // Get the system prompt from character knowledge
      const characterKnowledgeData =
        await this.characterKnowledge.getActiveCharacterKnowledge(
          conversationId
        );
      const enhancedInstructions = characterKnowledgeData?.systemPrompt || "";

      // Store in roleplay table
      const enhancement: RoleplayEnhancement = {
        baseRole,
        enhancedInstructions,
        confidence: 0.95,
        isSpecificCharacter: true,
        characterKnowledgeId,
      };

      await this.storeRoleplay(conversationId, userId, enhancement);

      console.log(
        `✅ [ROLEPLAY] Successfully created specific character roleplay`
      );

      return enhancement;
    } catch (error) {
      console.error("❌ [ROLEPLAY] Error handling specific character:", error);
      return null;
    }
  }

  async getActiveRoleplay(conversationId: string) {
    try {
      return await this.prisma.roleplay.findFirst({
        where: {
          conversationId,
          isActive: true,
        },
        orderBy: { updatedAt: "desc" },
      });
    } catch (error) {
      console.error("Error getting active roleplay:", error);
      return null;
    }
  }

  async getRoleplaysByUser(userId: string) {
    try {
      return await this.prisma.roleplay.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });
    } catch (error) {
      console.error("Error getting roleplays by user:", error);
      return [];
    }
  }

  async updateRoleplay(
    conversationId: string,
    roleplayUpdate: RoleplayUpdate
  ): Promise<boolean> {
    try {
      const existingRoleplay = await this.prisma.roleplay.findFirst({
        where: { conversationId },
      });

      if (existingRoleplay) {
        const updateData: any = {
          baseRole: roleplayUpdate.baseRole,
          isActive: roleplayUpdate.isActive,
          updatedAt: new Date(),
        };

        if (roleplayUpdate.enhancedInstructions !== undefined) {
          updateData.enhancedInstructions = roleplayUpdate.enhancedInstructions;
        }

        await this.prisma.roleplay.update({
          where: { id: existingRoleplay.id },
          data: updateData,
        });
      } else {
        const conversation = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
        });

        const createData: any = {
          conversationId,
          userId: conversation?.userId || null,
          baseRole: roleplayUpdate.baseRole,
          isActive: roleplayUpdate.isActive,
        };

        if (roleplayUpdate.enhancedInstructions !== undefined) {
          createData.enhancedInstructions = roleplayUpdate.enhancedInstructions;
        }

        await this.prisma.roleplay.create({
          data: createData,
        });
      }

      return true;
    } catch (error) {
      console.error("Error updating roleplay:", error);
      return false;
    }
  }

  async deactivateRoleplay(conversationId: string): Promise<boolean> {
    try {
      await this.prisma.roleplay.updateMany({
        where: {
          conversationId,
          isActive: true,
        },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      return true;
    } catch (error) {
      console.error("Error deactivating roleplay:", error);
      return false;
    }
  }

  async deleteRoleplay(
    conversationId: string,
    roleplayId: string
  ): Promise<boolean> {
    try {
      await this.prisma.roleplay.delete({
        where: {
          id: roleplayId,
          conversationId,
        },
      });

      return true;
    } catch (error) {
      console.error("Error deleting roleplay:", error);
      return false;
    }
  }

  async getRoleplayForPrompt(conversationId: string): Promise<string> {
    try {
      const activeRoleplay = await this.getActiveRoleplay(conversationId);

      if (!activeRoleplay || !activeRoleplay.enhancedInstructions) {
        return "";
      }

      return `\n\n## Role Instructions\n${activeRoleplay.enhancedInstructions}\n`;
    } catch (error) {
      console.error("Error getting roleplay for prompt:", error);
      return "";
    }
  }

  async analyzeAndEnhanceRole(
    baseRole: string,
    conversationContext: string,
    existingInstructions?: string | null
  ): Promise<RoleplayEnhancement | null> {
    try {
      const systemPrompt = `You are a roleplay enhancement AI. Your task is to take a basic role description and enhance it with detailed, contextual instructions that will help an AI assistant embody that role effectively.

TASK: Enhance the given role with specific behavioral instructions, communication style, knowledge areas, and interaction patterns.

GUIDELINES:
1. Create detailed, actionable instructions for the AI to follow
2. Include specific communication style and tone guidance
3. Define knowledge areas and expertise the role should demonstrate
4. Specify how the role should interact with users
5. Include any relevant personality traits or characteristics
6. Keep instructions practical and implementable
7. Ensure the enhancement is contextually relevant to the conversation

BASE ROLE: ${baseRole}

CONVERSATION CONTEXT:
${conversationContext}

EXISTING INSTRUCTIONS:
${existingInstructions || "None"}

Return a JSON object with the enhanced roleplay instructions:
{
  "baseRole": "${baseRole}",
  "enhancedInstructions": "Detailed instructions for embodying this role...",
  "confidence": 0.8
}

The enhanced instructions should be comprehensive but concise, focusing on actionable guidance for the AI assistant.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: "Please enhance this role with detailed instructions.",
          },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      });

      await this.usageTracking.trackUsage({
        operationType: "ROLEPLAY_ENHANCEMENT",
        model: "gpt-4o-mini",
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
        success: true,
        metadata: {
          baseRole,
          hasExistingInstructions: !!existingInstructions,
          contextLength: conversationContext.length,
        },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) return null;

      try {
        const enhancement = JSON.parse(content) as RoleplayEnhancement;

        // Validate the enhancement
        if (
          enhancement.baseRole &&
          enhancement.enhancedInstructions &&
          typeof enhancement.confidence === "number" &&
          enhancement.confidence >= 0.1 &&
          enhancement.confidence <= 1.0
        ) {
          return enhancement;
        }

        return null;
      } catch (parseError) {
        console.error(
          "Error parsing roleplay enhancement response:",
          parseError
        );
        return null;
      }
    } catch (error) {
      console.error("Error analyzing and enhancing role:", error);
      return null;
    }
  }

  private async storeRoleplay(
    conversationId: string,
    userId: string | null,
    enhancement: RoleplayEnhancement
  ): Promise<void> {
    try {
      // Deactivate any existing active roleplays
      await this.deactivateRoleplay(conversationId);

      // Ensure enhancedInstructions is a string
      const enhancedInstructionsString =
        typeof enhancement.enhancedInstructions === "string"
          ? enhancement.enhancedInstructions
          : JSON.stringify(enhancement.enhancedInstructions);

      // Create new enhanced roleplay
      await this.prisma.roleplay.create({
        data: {
          conversationId,
          userId,
          baseRole: enhancement.baseRole,
          enhancedInstructions: enhancedInstructionsString,
          isActive: true,
        },
      });
    } catch (error) {
      console.error("Error storing roleplay:", error);
    }
  }
}
