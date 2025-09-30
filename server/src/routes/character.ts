import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { apiLimiter } from "../middleware/rate-limiter";
import { validateConversationId } from "../middleware/validation";
import { asyncHandler } from "../middleware/error-handler";
import { CharacterKnowledgeService } from "../services/character-knowledge-service";
import { UsageTrackingService } from "../services/usage-tracking-service";

const router = Router();
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const usageTracking = new UsageTrackingService(prisma);
const characterKnowledgeService = new CharacterKnowledgeService(
  prisma,
  openai,
  usageTracking
);

/**
 * GET /api/character/:conversationId
 * Get active character knowledge for a conversation
 */
router.get(
  "/:conversationId",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    const characterKnowledge =
      await characterKnowledgeService.getActiveCharacterKnowledge(
        conversationId
      );

    if (!characterKnowledge) {
      return res.json({
        success: true,
        data: null,
        message: "No active character knowledge found for this conversation",
      });
    }

    return res.json({
      success: true,
      data: {
        id: characterKnowledge.id,
        characterName: characterKnowledge.characterName,
        characterSource: characterKnowledge.characterSource,
        knowledgeGraph: characterKnowledge.knowledgeGraph,
        systemPrompt: characterKnowledge.systemPrompt,
        chunks: characterKnowledge.chunks,
        isActive: characterKnowledge.isActive,
        createdAt: characterKnowledge.createdAt,
        updatedAt: characterKnowledge.updatedAt,
      },
    });
  })
);

/**
 * DELETE /api/character/:conversationId
 * Deactivate character knowledge for a conversation
 */
router.delete(
  "/:conversationId",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    await characterKnowledgeService.deactivateCharacterKnowledge(
      conversationId
    );

    return res.json({
      success: true,
      message: "Character knowledge deactivated successfully",
    });
  })
);

/**
 * POST /api/character/:conversationId/retrieve
 * Retrieve character context for a specific query (RAG retrieval)
 */
router.post(
  "/:conversationId/retrieve",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { query } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Query parameter is required and must be a string",
      });
    }

    const ragResult = await characterKnowledgeService.retrieveCharacterContext(
      conversationId,
      query
    );

    if (!ragResult) {
      return res.status(404).json({
        error: "No character knowledge found or retrieval failed",
      });
    }

    return res.json({
      success: true,
      data: {
        chunks: ragResult.chunks,
        systemPrompt: ragResult.systemPrompt,
      },
    });
  })
);

/**
 * POST /api/character/:conversationId/research
 * Research a character and create knowledge graph
 */
router.post(
  "/:conversationId/research",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { characterName, characterSource } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    if (!characterName || typeof characterName !== "string") {
      return res.status(400).json({
        error: "Character name is required and must be a string",
      });
    }

    // Get the roleplay service instance
    const { RoleplayService } = await import("../services/roleplay-service");
    const { UsageTrackingService } = await import(
      "../services/usage-tracking-service"
    );
    const OpenAI = (await import("openai")).default;
    const { PrismaClient } = await import("@prisma/client");
    const { ToolRegistry } = await import("../tools/tool-registry");

    const prisma = new PrismaClient();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const usageTracking = new UsageTrackingService(prisma);
    const roleplayService = new RoleplayService(prisma, openai, usageTracking);
    const toolRegistry = new ToolRegistry(prisma, openai);

    try {
      // Get web search tool for character research
      const webSearchTool = toolRegistry.getTool("web_search");

      if (!webSearchTool) {
        return res.status(500).json({
          error: "Web search tool not available",
        });
      }

      // Construct base role string
      const baseRole = characterSource
        ? `${characterName} from ${characterSource}`
        : characterName;

      // Use the roleplay service to research and create character
      const result = await roleplayService.enhanceAndStoreRoleplay(
        conversationId,
        null, // userId - will be set by service if needed
        baseRole,
        "", // conversationContext - not needed for UI-based creation
        webSearchTool
      );

      if (!result || !result.isSpecificCharacter) {
        return res.status(400).json({
          error:
            "Failed to research character. Please check the name and try again.",
        });
      }

      // Get the created character knowledge
      const characterKnowledge =
        await characterKnowledgeService.getActiveCharacterKnowledge(
          conversationId
        );

      if (!characterKnowledge) {
        return res.status(500).json({
          error: "Character knowledge created but could not be retrieved",
        });
      }

      return res.json({
        success: true,
        data: {
          characterName: characterKnowledge.characterName,
          characterSource: characterKnowledge.characterSource,
          systemPrompt: characterKnowledge.systemPrompt,
          chunkCount: characterKnowledge.chunks.length,
          knowledgeGraphId: characterKnowledge.id,
        },
      });
    } catch (error) {
      console.error("Character research error:", error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to research character",
      });
    } finally {
      await prisma.$disconnect();
    }
  })
);

export default router;
