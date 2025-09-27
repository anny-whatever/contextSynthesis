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
      avgResponseTime
    ] = await Promise.all([
      // Total usage records
      prisma.usageTracking.count({
        where: {
          createdAt: {
            gte: startDate
          }
        }
      }),
      
      // Total cost
      prisma.usageTracking.aggregate({
        where: {
          createdAt: {
            gte: startDate
          }
        },
        _sum: {
          totalCost: true
        }
      }),
      
      // Total tokens
      prisma.usageTracking.aggregate({
        where: {
          createdAt: {
            gte: startDate
          }
        },
        _sum: {
          inputTokens: true,
          outputTokens: true
        }
      }),
      
      // Total messages
      prisma.message.count({
        where: {
          createdAt: {
            gte: startDate
          }
        }
      }),
      
      // Total conversations
      prisma.conversation.count({
        where: {
          createdAt: {
            gte: startDate
          }
        }
      }),
      
      // Average response time
      prisma.usageTracking.aggregate({
        where: {
          createdAt: {
            gte: startDate
          },
          duration: {
            not: null
          }
        },
        _avg: {
          duration: true
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        timeframe,
        overview: {
          totalUsages,
          totalCost: totalCost._sum.totalCost || 0,
          totalTokens: (totalTokens._sum.inputTokens || 0) + (totalTokens._sum.outputTokens || 0),
          inputTokens: totalTokens._sum.inputTokens || 0,
          outputTokens: totalTokens._sum.outputTokens || 0,
          totalMessages,
          totalConversations,
          avgResponseTime: avgResponseTime._avg.duration || 0
        }
      }
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
      by: ['operationType'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        id: true
      },
      _sum: {
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        duration: true
      },
      _avg: {
        duration: true
      }
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
          totalTokens: (item._sum.inputTokens || 0) + (item._sum.outputTokens || 0),
          totalDuration: item._sum.duration || 0,
          avgDuration: item._avg.duration || 0
        }))
      }
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
          gte: startDate
        }
      },
      select: {
        createdAt: true,
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        duration: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Process the data to group by date
    const timelineMap = new Map();
    
    usageData.forEach(record => {
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
          recordCount: 0
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
    const timelineData = Array.from(timelineMap.values()).map(item => ({
      date: item.date,
      usageCount: item.usageCount,
      totalCost: item.totalCost,
      totalTokens: item.totalTokens,
      avgDuration: item.recordCount > 0 ? item.totalDuration / item.recordCount : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      data: {
        timeframe,
        granularity,
        timeline: timelineData
      }
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
      by: ['userId'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        id: true
      },
      _sum: {
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        duration: true
      },
      orderBy: {
        _sum: {
          totalCost: 'desc'
        }
      },
      take: Number(limit)
    });

    // Get user details and additional metrics
    const topUsersWithDetails = await Promise.all(
      topUsersData.map(async (userData: any) => {
        const user = await prisma.user.findUnique({
          where: { id: userData.userId },
          select: { id: true, email: true, name: true }
        });

        // Get additional metrics for this user
        const additionalMetrics = await prisma.usageTracking.aggregate({
          where: {
            userId: userData.userId,
            createdAt: { gte: startDate }
          },
          _count: {
            conversationId: true
          }
        });

        // Get unique conversation count
        const conversationCount = await prisma.usageTracking.findMany({
          where: {
            userId: userData.userId,
            createdAt: { gte: startDate }
          },
          select: { conversationId: true },
          distinct: ['conversationId']
        });

        return {
          userId: userData.userId,
          user: user || { id: userData.userId, email: 'Unknown User', name: null },
          totalUsage: userData._count.id,
          totalCost: userData._sum.totalCost || 0,
          totalTokens: (userData._sum.inputTokens || 0) + (userData._sum.outputTokens || 0),
          messageCount: userData._count.id,
          conversationCount: conversationCount.length,
          avgResponseTime: userData._sum.duration ? (userData._sum.duration / userData._count.id) : 0
        };
      })
    );

    res.json({
      success: true,
      data: {
        timeframe,
        topUsers: topUsersWithDetails
      }
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
            gte: startDate
          }
        }
      }),
      prisma.usageTracking.count({
        where: {
          createdAt: {
            gte: startDate
          },
          errorMessage: {
            not: null
          }
        }
      })
    ]);

    const errorsByType = await prisma.usageTracking.groupBy({
      by: ['operationType'],
      where: {
        createdAt: {
          gte: startDate
        },
        errorMessage: {
          not: null
        }
      },
      _count: {
        id: true
      }
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
          errorCount: item._count.id
        }))
      }
    });
  })
);

export default router;