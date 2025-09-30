import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { UsageTrackingService } from "./usage-tracking-service";
import { CharacterResearchService } from "./character-research-service";
import { CharacterKnowledgeService } from "./character-knowledge-service";

export interface CharacterResearchResult {
  characterName: string;
  characterSource: string;
  characterKnowledgeId: string;
  systemPrompt: string;
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

  /**
   * Research a character and create knowledge graph
   * This is the main entry point for character research mode
   */
  async researchAndStoreCharacter(
    conversationId: string,
    characterName: string,
    characterSource: string | undefined,
    webSearchTool?: any
  ): Promise<CharacterResearchResult | null> {
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
        console.warn("⚠️ [ROLEPLAY] Character research failed");
        return null;
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
      const systemPrompt = characterKnowledgeData?.systemPrompt || "";

      console.log(
        `✅ [ROLEPLAY] Successfully created character research for ${characterName}`
      );

      return {
        characterName,
        characterSource: characterSource || "Unknown",
        characterKnowledgeId,
        systemPrompt,
      };
    } catch (error) {
      console.error("❌ [ROLEPLAY] Error researching character:", error);
      return null;
    }
  }

  /**
   * Enhanced version that maintains backward compatibility with old code
   * Detects if it's a specific character and researches accordingly
   */
  async enhanceAndStoreRoleplay(
    conversationId: string,
    userId: string | null,
    baseRole: string,
    conversationContext: string,
    webSearchTool?: any
  ): Promise<{
    isSpecificCharacter: boolean;
    characterKnowledgeId?: string;
  } | null> {
    try {
      console.log(`🎭 [ROLEPLAY] Processing: ${baseRole}`);

      // Detect if this is a specific character
      const detection = await this.characterResearch.detectSpecificCharacter(
        baseRole,
        conversationContext
      );

      console.log(`🎭 [ROLEPLAY] Character detection:`, detection);

      // If specific character detected, do full research and knowledge graph
      if (detection.isSpecificCharacter && detection.characterName) {
        const result = await this.researchAndStoreCharacter(
          conversationId,
          detection.characterName,
          detection.characterSource,
          webSearchTool
        );

        if (result) {
          return {
            isSpecificCharacter: true,
            characterKnowledgeId: result.characterKnowledgeId,
          };
        }
      }

      // Not a specific character or research failed
      console.log("⚠️ [ROLEPLAY] Not a specific character or research failed");
      return {
        isSpecificCharacter: false,
      };
    } catch (error) {
      console.error("Error in enhanceAndStoreRoleplay:", error);
      return null;
    }
  }
}
