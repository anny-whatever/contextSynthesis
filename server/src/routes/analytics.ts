import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { apiLimiter } from "../middleware/rate-limiter";
import { asyncHandler } from "../middleware/error-handler";

const router = Router();
const prisma = new PrismaClient();

// GET /api/analytics/overview - Get overall usage statistics
router.get(
  "/overview",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d" } = req.query;

    // Calculate date range based on timeframe
    const now = new Date();
    let startDate = new Date();

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get total usage statistics
    const [
      totalUsages,
      totalCost,
      totalTokens,
      totalMessages,
      totalConversations,
      avgResponseTime,
    ] = await Promise.all([
      // Total usage records
      prisma.usageTracking.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      }),

      // Total cost
      prisma.usageTracking.aggregate({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
        _sum: {
          totalCost: true,
        },
      }),

      // Total tokens
      prisma.usageTracking.aggregate({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
        _sum: {
          inputTokens: true,
          outputTokens: true,
        },
      }),

      // Total messages
      prisma.message.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      }),

      // Total conversations
      prisma.conversation.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      }),

      // Average response time
      prisma.usageTracking.aggregate({
        where: {
          createdAt: {
            gte: startDate,
          },
          duration: {
            not: null,
          },
        },
        _avg: {
          duration: true,
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        timeframe,
        overview: {
          totalUsages,
          totalCost: totalCost._sum.totalCost || 0,
          totalTokens:
            (totalTokens._sum.inputTokens || 0) +
            (totalTokens._sum.outputTokens || 0),
          inputTokens: totalTokens._sum.inputTokens || 0,
          outputTokens: totalTokens._sum.outputTokens || 0,
          totalMessages,
          totalConversations,
          avgResponseTime: avgResponseTime._avg.duration || 0,
        },
      },
    });
  })
);

// GET /api/analytics/usage-by-operation - Get usage breakdown by operation type
router.get(
  "/usage-by-operation",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d" } = req.query;

    const now = new Date();
    let startDate = new Date();

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    const usageByOperation = await prisma.usageTracking.groupBy({
      by: ["operationType"],
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        duration: true,
      },
      _avg: {
        duration: true,
      },
    });

    res.json({
      success: true,
      data: {
        timeframe,
        usageByOperation: usageByOperation.map((item: any) => ({
          operationType: item.operationType,
          count: item._count.id,
          totalCost: item._sum.totalCost || 0,
          totalInputTokens: item._sum.inputTokens || 0,
          totalOutputTokens: item._sum.outputTokens || 0,
          totalTokens:
            (item._sum.inputTokens || 0) + (item._sum.outputTokens || 0),
          totalDuration: item._sum.duration || 0,
          avgDuration: item._avg.duration || 0,
        })),
      },
    });
  })
);

// GET /api/analytics/usage-timeline - Get usage over time for charts
router.get(
  "/usage-timeline",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d", granularity = "day" } = req.query;

    const now = new Date();
    let startDate = new Date();
    let dateFormat = "%Y-%m-%d";

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        dateFormat = "%Y-%m-%d %H:00:00";
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        dateFormat = "%Y-%m-%d";
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        dateFormat = "%Y-%m-%d";
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        dateFormat = "%Y-%m-%d";
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get usage timeline data using Prisma's groupBy instead of raw SQL
    const usageData = await prisma.usageTracking.findMany({
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      select: {
        createdAt: true,
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        duration: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Process the data to group by date
    const timelineMap = new Map();

    usageData.forEach((record) => {
      let dateKey: string;
      if (timeframe === "24h") {
        // Group by hour
        dateKey = record.createdAt.toISOString().substring(0, 13) + ":00:00";
      } else {
        // Group by day
        dateKey = record.createdAt.toISOString().substring(0, 10);
      }

      if (!timelineMap.has(dateKey)) {
        timelineMap.set(dateKey, {
          date: dateKey,
          usageCount: 0,
          totalCost: 0,
          totalTokens: 0,
          totalDuration: 0,
          recordCount: 0,
        });
      }

      const dayData = timelineMap.get(dateKey);
      dayData.usageCount += 1;
      dayData.totalCost += record.totalCost;
      dayData.totalTokens += record.inputTokens + record.outputTokens;
      if (record.duration) {
        dayData.totalDuration += record.duration;
        dayData.recordCount += 1;
      }
    });

    // Convert to array and calculate averages
    const timelineData = Array.from(timelineMap.values())
      .map((item) => ({
        date: item.date,
        usageCount: item.usageCount,
        totalCost: item.totalCost,
        totalTokens: item.totalTokens,
        avgDuration:
          item.recordCount > 0 ? item.totalDuration / item.recordCount : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      data: {
        timeframe,
        granularity,
        timeline: timelineData,
      },
    });
  })
);

// GET /api/analytics/top-users - Get top users by usage
router.get(
  "/top-users",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d", limit = 10 } = req.query;

    const now = new Date();
    let startDate = new Date();

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get aggregated usage data
    const topUsersData = await prisma.usageTracking.groupBy({
      by: ["userId"],
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        duration: true,
      },
      orderBy: {
        _sum: {
          totalCost: "desc",
        },
      },
      take: Number(limit),
    });

    // Get user details and additional metrics
    const topUsersWithDetails = await Promise.all(
      topUsersData.map(async (userData: any) => {
        const user = await prisma.user.findUnique({
          where: { id: userData.userId },
          select: { id: true, email: true, name: true },
        });

        // Get additional metrics for this user
        const additionalMetrics = await prisma.usageTracking.aggregate({
          where: {
            userId: userData.userId,
            createdAt: { gte: startDate },
          },
          _count: {
            conversationId: true,
          },
        });

        // Get unique conversation count
        const conversationCount = await prisma.usageTracking.findMany({
          where: {
            userId: userData.userId,
            createdAt: { gte: startDate },
          },
          select: { conversationId: true },
          distinct: ["conversationId"],
        });

        return {
          userId: userData.userId,
          user: user || {
            id: userData.userId,
            email: "Unknown User",
            name: null,
          },
          totalUsage: userData._count.id,
          totalCost: userData._sum.totalCost || 0,
          totalTokens:
            (userData._sum.inputTokens || 0) +
            (userData._sum.outputTokens || 0),
          messageCount: userData._count.id,
          conversationCount: conversationCount.length,
          avgResponseTime: userData._sum.duration
            ? userData._sum.duration / userData._count.id
            : 0,
        };
      })
    );

    res.json({
      success: true,
      data: {
        timeframe,
        topUsers: topUsersWithDetails,
      },
    });
  })
);

// GET /api/analytics/error-rates - Get error rates and failed operations
router.get(
  "/error-rates",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d" } = req.query;

    const now = new Date();
    let startDate = new Date();

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    const [totalUsages, errorUsages] = await Promise.all([
      prisma.usageTracking.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      }),
      prisma.usageTracking.count({
        where: {
          createdAt: {
            gte: startDate,
          },
          errorMessage: {
            not: null,
          },
        },
      }),
    ]);

    const errorsByType = await prisma.usageTracking.groupBy({
      by: ["operationType"],
      where: {
        createdAt: {
          gte: startDate,
        },
        errorMessage: {
          not: null,
        },
      },
      _count: {
        id: true,
      },
    });

    const errorRate = totalUsages > 0 ? (errorUsages / totalUsages) * 100 : 0;

    res.json({
      success: true,
      data: {
        timeframe,
        errorRate,
        totalUsages,
        errorUsages,
        errorsByType: errorsByType.map((item: any) => ({
          operationType: item.operationType,
          errorCount: item._count.id,
        })),
      },
    });
  })
);

// GET /api/analytics/per-message-usage - Get usage aggregated per message
router.get(
  "/per-message-usage",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d", limit = 50 } = req.query;

    const now = new Date();
    let startDate = new Date();

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get usage data grouped by messageId
    const messageUsage = await prisma.usageTracking.groupBy({
      by: ["messageId"],
      where: {
        messageId: {
          not: null,
        },
        createdAt: {
          gte: startDate,
        },
      },
      _sum: {
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        duration: true,
      },
      _count: {
        id: true,
      },
      _max: {
        createdAt: true,
      },
      orderBy: {
        _max: {
          createdAt: "desc",
        },
      },
      take: parseInt(limit as string),
    });

    // Get message details for the messageIds
    const messageIds = messageUsage
      .map((item) => item.messageId)
      .filter(Boolean);
    const messages = await prisma.message.findMany({
      where: {
        id: {
          in: messageIds as string[],
        },
      },
      select: {
        id: true,
        content: true,
        role: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: {
            title: true,
          },
        },
      },
    });

    const messageMap = new Map(messages.map((msg) => [msg.id, msg]));

    const enrichedData = messageUsage.map((usage) => {
      const message = messageMap.get(usage.messageId!);
      return {
        messageId: usage.messageId,
        totalCost: usage._sum.totalCost || 0,
        totalTokens: usage._sum.totalTokens || 0,
        inputTokens: usage._sum.inputTokens || 0,
        outputTokens: usage._sum.outputTokens || 0,
        operationCount: usage._count.id,
        totalDuration: usage._sum.duration || 0,
        lastActivity: usage._max.createdAt,
        messageContent:
          message?.content?.substring(0, 100) +
          (message?.content && message.content.length > 100 ? "..." : ""),
        messageRole: message?.role,
        conversationTitle: message?.conversation?.title,
        conversationId: message?.conversationId,
        createdAt: message?.createdAt,
      };
    });

    res.json({
      success: true,
      data: {
        timeframe,
        messages: enrichedData,
        totalMessages: enrichedData.length,
      },
    });
  })
);

// GET /api/analytics/operation-cost-breakdown - Get cost breakdown by operation type and subtype
router.get(
  "/operation-cost-breakdown",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d" } = req.query;

    const now = new Date();
    let startDate = new Date();

    switch (timeframe) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get operation breakdown data
    const operationBreakdown = await prisma.usageTracking.groupBy({
      by: ["operationType", "operationSubtype"],
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      _sum: {
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          totalCost: "desc",
        },
      },
    });

    // Get timeline data for operation costs
    const timelineData = await prisma.usageTracking.findMany({
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      select: {
        createdAt: true,
        operationType: true,
        operationSubtype: true,
        totalCost: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Process timeline data for area chart
    const timelineMap = new Map();
    const operationTypes = new Set();

    timelineData.forEach((record) => {
      const dateKey = record.createdAt.toISOString().substring(0, 10);
      const operationKey = record.operationSubtype || record.operationType;
      operationTypes.add(operationKey);

      if (!timelineMap.has(dateKey)) {
        timelineMap.set(dateKey, {
          date: dateKey,
          total: 0,
        });
      }

      const dayData = timelineMap.get(dateKey);
      if (!dayData[operationKey]) {
        dayData[operationKey] = 0;
      }
      dayData[operationKey] += record.totalCost;
      dayData.total += record.totalCost;
    });

    const timeline = Array.from(timelineMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const breakdown = operationBreakdown.map((item) => ({
      operationType: item.operationType,
      operationSubtype: item.operationSubtype,
      displayName: item.operationSubtype || item.operationType,
      totalCost: item._sum.totalCost || 0,
      totalTokens: item._sum.totalTokens || 0,
      inputTokens: item._sum.inputTokens || 0,
      outputTokens: item._sum.outputTokens || 0,
      operationCount: item._count.id,
    }));

    res.json({
      success: true,
      data: {
        timeframe,
        breakdown,
        timeline,
        operationTypes: Array.from(operationTypes),
      },
    });
  })
);

// GET /api/analytics/cumulative-cost - Get cumulative cost over message count
router.get(
  "/cumulative-cost",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d" } = req.query;

    // Calculate start date based on timeframe
    const now = new Date();
    let startDate: Date;

    switch (timeframe) {
      case "1d":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get usage tracking data for cumulative cost calculation
    const usageData = await prisma.usageTracking.findMany({
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      select: {
        messageId: true,
        totalCost: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // First, group by messageId to get total cost per message
    const messageMap = new Map();

    usageData.forEach((record) => {
      if (!messageMap.has(record.messageId)) {
        messageMap.set(record.messageId, {
          messageId: record.messageId,
          totalCost: 0,
          createdAt: record.createdAt,
        });
      }
      
      const messageData = messageMap.get(record.messageId);
      messageData.totalCost += record.totalCost;
      // Keep the earliest createdAt for this message
      if (record.createdAt < messageData.createdAt) {
        messageData.createdAt = record.createdAt;
      }
    });

    // Convert to array and sort by creation time to get proper message order
    const messagesArray = Array.from(messageMap.values()).sort((a, b) => 
      a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Calculate cumulative cost across messages in chronological order
    let cumulativeCost = 0;
    const cumulativeData = messagesArray.map((message, index) => {
      cumulativeCost += message.totalCost;
      return {
        messageCount: index + 1,
        cumulativeCost: cumulativeCost,
        createdAt: message.createdAt.toISOString(),
      };
    });

    res.json({
      success: true,
      data: cumulativeData,
    });
  })
);

// Get per-message operation cost timeline for multi-line chart
router.get(
  "/per-message-operation-timeline",
  apiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { timeframe = "7d" } = req.query;

    // Calculate start date based on timeframe
    const now = new Date();
    let startDate: Date;

    switch (timeframe) {
      case "1d":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get usage tracking data grouped by message and operation type
    const usageData = await prisma.usageTracking.findMany({
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      select: {
        messageId: true,
        operationType: true,
        operationSubtype: true,
        totalCost: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Group by messageId and operation type
    const messageMap = new Map();
    const operationTypes = new Set<string>();
    let messageCount = 0;

    // First pass: collect all operation types and create message entries
    usageData.forEach((record) => {
      const operationKey = record.operationSubtype || record.operationType;
      operationTypes.add(operationKey);

      if (!messageMap.has(record.messageId)) {
        messageCount++;
        messageMap.set(record.messageId, {
          messageCount,
          messageId: record.messageId,
          createdAt: record.createdAt.toISOString(),
        });
      }

      const messageData = messageMap.get(record.messageId);
      if (!messageData[operationKey]) {
        messageData[operationKey] = 0;
      }
      messageData[operationKey] += record.totalCost;
    });

    // Second pass: ensure all messages have all operation types (fill missing with 0)
    const operationTypesArray = Array.from(operationTypes);
    messageMap.forEach((messageData) => {
      operationTypesArray.forEach((opType: string) => {
        if ((messageData as any)[opType] === undefined) {
          (messageData as any)[opType] = 0;
        }
      });
    });

    const timelineData = Array.from(messageMap.values()).sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    res.json({
      success: true,
      data: {
        timeline: timelineData,
        operationTypes: Array.from(operationTypes),
      },
    });
  })
);

export default router;
