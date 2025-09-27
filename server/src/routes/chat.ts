import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { chatLimiter, apiLimiter } from "../middleware/rate-limiter";
import {
  validateChatRequest,
  validateCreateConversationRequest,
  validateConversationId,
  validateUserId,
} from "../middleware/validation";
import { asyncHandler } from "../middleware/error-handler";
import { AgentService } from "../services/agent-service";
import { encode } from "gpt-tokenizer";

const router = Router();
const prisma = new PrismaClient();
const agentService = new AgentService();

// POST /api/chat - Send a message and get AI response
router.post(
  "/",
  // chatLimiter, // DISABLED
  validateChatRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { message, conversationId, userId, context } = req.body;

    try {
      const agentResponse = await agentService.processMessage({
        message,
        conversationId,
        userId: userId || "anonymous",
        context,
      });

      res.json({
        success: true,
        data: {
          message: agentResponse.message,
          conversationId: agentResponse.conversationId,
          timestamp: agentResponse.metadata.timestamp.toISOString(),
          toolsUsed: agentResponse.toolsUsed,
          context: agentResponse.context,
          metadata: agentResponse.metadata,
        },
      });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({
        success: false,
        error: {
          message: "Failed to process chat message",
          statusCode: 500,
        },
      });
    }
  })
);

// POST /api/chat/conversations - Create a new conversation
router.post(
  "/conversations",
  apiLimiter,
  validateCreateConversationRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { title, userId } = req.body;

    const conversation = await prisma.conversation.create({
      data: {
        title: title || "New Conversation",
        userId: userId || "anonymous",
      },
    });

    res.status(201).json({
      success: true,
      data: conversation,
    });
  })
);

// GET /api/chat/conversations/:id - Get conversation details
router.get(
  "/conversations/:id",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          include: {
            toolUsages: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Conversation not found",
          statusCode: 404,
        },
      });
    }

    return res.json({
      success: true,
      data: conversation,
    });
  })
);

// GET /api/chat/conversations/:id/messages - Get conversation messages
router.get(
  "/conversations/:id/messages",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    // Check if conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Conversation not found",
          statusCode: 404,
        },
      });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      include: {
        toolUsages: true,
      },
      orderBy: { createdAt: "asc" },
      take: Number(limit),
      skip: Number(offset),
    });

    const totalCount = await prisma.message.count({
      where: { conversationId },
    });

    return res.json({
      success: true,
      data: {
        messages,
        pagination: {
          total: totalCount,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: Number(offset) + messages.length < totalCount,
        },
      },
    });
  })
);

// DELETE /api/chat/conversations/:id - Delete a conversation
router.delete(
  "/conversations/:id",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    // Check if conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Conversation not found",
          statusCode: 404,
        },
      });
    }

    // Delete the conversation and all associated messages
    await prisma.conversation.delete({
      where: { id: conversationId },
    });

    return res.json({
      success: true,
      message: "Conversation deleted successfully",
    });
  })
);

// GET /api/chat/user/:userId/conversations - Get user's conversations
router.get(
  "/user/:userId/conversations",
  apiLimiter,
  validateUserId,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId = "anonymous", limit = 20, offset = 0 } = req.query;

    const conversations = await prisma.conversation.findMany({
      where: { userId: userId as string },
      orderBy: { updatedAt: "desc" },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      include: {
        _count: {
          select: { messages: true },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            content: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    const totalCount = await prisma.conversation.count({
      where: { userId: userId as string },
    });

    return res.json({
      success: true,
      data: {
        conversations,
        pagination: {
          total: totalCount,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          hasMore:
            totalCount > parseInt(offset as string) + conversations.length,
        },
      },
    });
  })
);

// GET /api/chat/conversations/:id/summaries - Get conversation summaries
router.get(
  "/conversations/:id/summaries",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    // Check if conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Conversation not found",
          statusCode: 404,
        },
      });
    }

    const summaries = await prisma.conversationSummary.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        summaryText: true,
        topicName: true,
        relatedTopics: true,
        messageRange: true,
        summaryLevel: true,
        topicRelevance: true,
        batchId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      success: true,
      data: {
        summaries,
        total: summaries.length,
      },
    });
  })
);

// GET /api/chat/conversations/:id/intent-analyses - Get conversation intent analyses
router.get(
  "/conversations/:id/intent-analyses",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    // Check if conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Conversation not found",
          statusCode: 404,
        },
      });
    }

    const intentAnalyses = await prisma.intentAnalysis.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: Number(offset),
      include: {
        userMessage: {
          select: {
            content: true,
            createdAt: true,
          },
        },
      },
    });

    const totalCount = await prisma.intentAnalysis.count({
      where: { conversationId },
    });

    return res.json({
      success: true,
      data: {
        intentAnalyses,
        pagination: {
          total: totalCount,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: Number(offset) + intentAnalyses.length < totalCount,
        },
      },
    });
  })
);

// GET /api/chat/conversations/:id/tokens - Get total token count for conversation
router.get(
  "/conversations/:id/tokens",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    // Get all messages for the conversation
    const messages = await prisma.message.findMany({
      where: { conversationId },
      select: { content: true, role: true },
      orderBy: { createdAt: "asc" },
    });

    if (messages.length === 0) {
      return res.json({
        success: true,
        data: {
          conversationId,
          totalTokens: 0,
          messageCount: 0,
          breakdown: {
            userTokens: 0,
            assistantTokens: 0,
            systemTokens: 0,
            toolTokens: 0,
          },
        },
      });
    }

    // Calculate tokens for each message and categorize by role
    let totalTokens = 0;
    const breakdown = {
      userTokens: 0,
      assistantTokens: 0,
      systemTokens: 0,
      toolTokens: 0,
    };

    for (const message of messages) {
      const tokens = encode(message.content).length;
      totalTokens += tokens;

      switch (message.role) {
        case "USER":
          breakdown.userTokens += tokens;
          break;
        case "ASSISTANT":
          breakdown.assistantTokens += tokens;
          break;
        case "SYSTEM":
          breakdown.systemTokens += tokens;
          break;
        case "TOOL":
          breakdown.toolTokens += tokens;
          break;
      }
    }

    return res.json({
      success: true,
      data: {
        conversationId,
        totalTokens,
        messageCount: messages.length,
        breakdown,
      },
    });
  })
);

export default router;
