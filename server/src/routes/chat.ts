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
import { BehavioralMemoryService } from "../services/behavioral-memory-service";
import { encode } from "gpt-tokenizer";

// Streaming interfaces
export interface StreamingEvent {
  type:
    | "connection"
    | "tool_start"
    | "tool_complete"
    | "tool_error"
    | "message_chunk"
    | "message_complete"
    | "error";
  data: any;
  timestamp: string;
}

class SSEConnection {
  private res: Response;
  private isActive: boolean = true;

  constructor(res: Response) {
    this.res = res;
    this.setupSSE();
  }

  private setupSSE() {
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // Send initial connection event
    this.sendEvent({
      type: "connection",
      data: { status: "connected" },
      timestamp: new Date().toISOString(),
    });

    // Handle client disconnect
    this.res.on("close", () => {
      this.isActive = false;
    });
  }

  sendEvent(event: StreamingEvent) {
    if (!this.isActive) return;

    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  close() {
    if (this.isActive) {
      this.sendEvent({
        type: "connection",
        data: { status: "closed" },
        timestamp: new Date().toISOString(),
      });
      this.res.end();
      this.isActive = false;
    }
  }

  isConnected(): boolean {
    return this.isActive;
  }
}

const router = Router();
const prisma = new PrismaClient();
const agentService = new AgentService();
const behavioralMemoryService = new BehavioralMemoryService();
// Note: MemoryService and RoleplayService will be instantiated within route handlers
// since they require OpenAI and UsageTrackingService instances

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

// POST /api/chat/stream - Send a message and get streaming AI response
router.post(
  "/stream",
  validateChatRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { message, conversationId, userId, context } = req.body;
    const sseConnection = new SSEConnection(res);

    try {
      // Process message with streaming callback
      const agentResponse = await agentService.processMessageWithStreaming({
        message,
        conversationId,
        userId: userId || "anonymous",
        context,
        onStreamEvent: (event: StreamingEvent) => {
          sseConnection.sendEvent(event);
        },
      });

      // Send final completion event
      sseConnection.sendEvent({
        type: "message_complete",
        data: {
          message: agentResponse.message,
          conversationId: agentResponse.conversationId,
          timestamp: agentResponse.metadata.timestamp.toISOString(),
          toolsUsed: agentResponse.toolsUsed,
          context: agentResponse.context,
          metadata: agentResponse.metadata,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Streaming chat error:", error);
      sseConnection.sendEvent({
        type: "error",
        data: {
          message: "Failed to process chat message",
          statusCode: 500,
        },
        timestamp: new Date().toISOString(),
      });
    } finally {
      sseConnection.close();
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

    // Transform conversation messages to match frontend expected structure
    const transformedConversation = {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        toolUsages: message.toolUsages.map((toolUsage) => ({
          toolName: toolUsage.toolName,
          input: toolUsage.input,
          output: toolUsage.output,
          success: toolUsage.status === "COMPLETED",
          duration: toolUsage.duration,
          error: toolUsage.error,
        })),
      })),
    };

    return res.json({
      success: true,
      data: transformedConversation,
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

    // Transform messages to match frontend expected structure
    const transformedMessages = messages.map((message) => ({
      ...message,
      toolUsages: message.toolUsages.map((toolUsage) => ({
        toolName: toolUsage.toolName,
        input: toolUsage.input,
        output: toolUsage.output,
        success: toolUsage.status === "COMPLETED",
        duration: toolUsage.duration,
        error: toolUsage.error,
      })),
    }));

    return res.json({
      success: true,
      data: {
        messages: transformedMessages,
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

// GET /api/chat/conversations/:id/behavioral-memory - Get behavioral memory for conversation
router.get(
  "/conversations/:id/behavioral-memory",
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

    try {
      // Get both the new behaviors JSON field and legacy behavioralMemory string field
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          behaviors: true,
          behavioralMemory: true,
        },
      });

      const behaviors = (conversation?.behaviors as Record<string, any>) || {};
      const legacyBehavioralMemory = conversation?.behavioralMemory || "";

      // Format behaviors as human-readable points
      const behavioralMemoryPoints =
        behavioralMemoryService.formatBehavioralMemoryAsPoints(behaviors);

      // Use points format if available, otherwise fall back to legacy string
      const displayMemory = behavioralMemoryPoints || legacyBehavioralMemory;

      return res.json({
        success: true,
        data: {
          conversationId,
          behavioralMemory: displayMemory,
          behaviors: behaviors,
          wordCount: displayMemory
            ? displayMemory.trim().split(/\s+/).length
            : 0,
        },
      });
    } catch (error) {
      console.error("Error getting behavioral memory:", error);
      return res.status(500).json({
        success: false,
        error: {
          message: "Failed to get behavioral memory",
          statusCode: 500,
        },
      });
    }
  })
);

// PUT /api/chat/conversations/:id/behavioral-memory - Update behavioral memory for conversation
router.put(
  "/conversations/:id/behavioral-memory",
  apiLimiter,
  validateConversationId,
  asyncHandler(async (req: Request, res: Response) => {
    const { id: conversationId } = req.params;
    const { behavioralMemory } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Conversation ID is required",
          statusCode: 400,
        },
      });
    }

    if (typeof behavioralMemory !== "string") {
      return res.status(400).json({
        success: false,
        error: {
          message: "Behavioral memory must be a string",
          statusCode: 400,
        },
      });
    }

    // Validate word count
    const wordCount = behavioralMemory.trim().split(/\s+/).length;
    if (wordCount > 300) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Behavioral memory too long: ${wordCount} words (max 300)`,
          statusCode: 400,
        },
      });
    }

    try {
      // Update the legacy behavioralMemory string field for manual edits
      // The behaviors JSON field is managed automatically by the AI system
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          behavioralMemory,
          updatedAt: new Date(),
        },
      });

      return res.json({
        success: true,
        data: {
          conversationId,
          behavioralMemory,
          wordCount: behavioralMemory.trim().split(/\s+/).length,
          message: "Behavioral memory updated successfully",
        },
      });
    } catch (error) {
      console.error("Error updating behavioral memory:", error);
      return res.status(500).json({
        success: false,
        error: {
          message: "Failed to update behavioral memory",
          statusCode: 500,
        },
      });
    }
  })
);

export default router;
