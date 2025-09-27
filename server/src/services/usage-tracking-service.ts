import { PrismaClient, UsageOperationType } from "@prisma/client";
import {
  CostService,
  TokenUsage,
  WebSearchUsage,
  CostCalculation,
} from "./cost-service";

export interface UsageTrackingData {
  conversationId?: string;
  messageId?: string;
  userId?: string;
  operationType: UsageOperationType;
  operationSubtype?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  duration?: number;
  success?: boolean;
  errorMessage?: string;
  metadata?: any;
  batchId?: string;
  webSearchUsage?: WebSearchUsage;
}

export interface UsageAnalytics {
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  operationBreakdown: {
    operationType: UsageOperationType;
    count: number;
    totalCost: number;
    totalTokens: number;
  }[];
  dailyUsage: {
    date: string;
    totalCost: number;
    totalTokens: number;
    operationCounts: Record<string, number>;
  }[];
  modelBreakdown: {
    model: string;
    count: number;
    totalCost: number;
    totalTokens: number;
  }[];
}

export interface UsageFilters {
  conversationId?: string;
  userId?: string;
  operationType?: UsageOperationType;
  model?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
}

export class UsageTrackingService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Track a single AI operation usage
   */
  async trackUsage(data: UsageTrackingData): Promise<string> {
    try {
      // Calculate cost using existing CostService
      const tokenUsage: TokenUsage = {
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      };

      const costCalculation = CostService.calculateCost(
        data.model,
        tokenUsage,
        data.webSearchUsage
      );

      // Create usage tracking record
      const createData: any = {
        operationType: data.operationType,
        model: data.model,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.inputTokens + data.outputTokens,
        inputCost: costCalculation.inputCost,
        outputCost: costCalculation.outputCost,
        totalCost: costCalculation.totalCost,
        success: data.success ?? true,
      };

      // Only add optional fields if they have values
      if (data.conversationId) createData.conversationId = data.conversationId;
      if (data.messageId) createData.messageId = data.messageId;
      if (data.userId) createData.userId = data.userId;
      if (data.operationSubtype)
        createData.operationSubtype = data.operationSubtype;
      if (data.duration) createData.duration = data.duration;
      if (data.errorMessage) createData.errorMessage = data.errorMessage;
      if (data.batchId) createData.batchId = data.batchId;
      if (data.metadata)
        createData.metadata = JSON.parse(JSON.stringify(data.metadata));

      const usageRecord = await this.prisma.usageTracking.create({
        data: createData,
      });

      console.log("💰 [USAGE-TRACKING] Recorded usage:", {
        id: usageRecord.id,
        operationType: data.operationType,
        operationSubtype: data.operationSubtype,
        model: data.model,
        totalTokens: usageRecord.totalTokens,
        totalCost: usageRecord.totalCost,
        formattedCost: CostService.formatCost(usageRecord.totalCost),
      });

      return usageRecord.id;
    } catch (error) {
      console.error("Failed to track usage:", error);
      throw new Error(
        `Usage tracking failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Track multiple operations in a batch (e.g., for summarization)
   */
  async trackBatchUsage(
    operations: UsageTrackingData[],
    batchId?: string
  ): Promise<string[]> {
    const generatedBatchId =
      batchId ||
      `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const results: string[] = [];
    for (const operation of operations) {
      const usageId = await this.trackUsage({
        ...operation,
        batchId: generatedBatchId,
      });
      results.push(usageId);
    }

    console.log("💰 [USAGE-TRACKING] Recorded batch usage:", {
      batchId: generatedBatchId,
      operationCount: operations.length,
      totalCost: operations.reduce((sum, op) => {
        const tokenUsage: TokenUsage = {
          inputTokens: op.inputTokens,
          outputTokens: op.outputTokens,
        };
        const cost = CostService.calculateCost(
          op.model,
          tokenUsage,
          op.webSearchUsage
        );
        return sum + cost.totalCost;
      }, 0),
    });

    return results;
  }

  /**
   * Get usage analytics with filtering
   */
  async getUsageAnalytics(filters: UsageFilters = {}): Promise<UsageAnalytics> {
    const whereClause: any = {};

    if (filters.conversationId)
      whereClause.conversationId = filters.conversationId;
    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.operationType)
      whereClause.operationType = filters.operationType;
    if (filters.model) whereClause.model = filters.model;
    if (filters.success !== undefined) whereClause.success = filters.success;
    if (filters.startDate || filters.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) whereClause.createdAt.gte = filters.startDate;
      if (filters.endDate) whereClause.createdAt.lte = filters.endDate;
    }

    // Get aggregated data
    const [totalStats, operationBreakdown, modelBreakdown, dailyUsage] =
      await Promise.all([
        // Total stats
        this.prisma.usageTracking.aggregate({
          where: whereClause,
          _sum: {
            totalCost: true,
            totalTokens: true,
            inputTokens: true,
            outputTokens: true,
          },
        }),

        // Operation breakdown
        this.prisma.usageTracking.groupBy({
          by: ["operationType"],
          where: whereClause,
          _count: { id: true },
          _sum: {
            totalCost: true,
            totalTokens: true,
          },
        }),

        // Model breakdown
        this.prisma.usageTracking.groupBy({
          by: ["model"],
          where: whereClause,
          _count: { id: true },
          _sum: {
            totalCost: true,
            totalTokens: true,
          },
        }),

        // Daily usage (last 30 days)
        this.prisma.$queryRaw`
        SELECT 
          DATE(created_at) as date,
          SUM(total_cost) as total_cost,
          SUM(total_tokens) as total_tokens,
          operation_type,
          COUNT(*) as count
        FROM usage_tracking 
        WHERE created_at >= NOW() - INTERVAL '30 days'
        ${
          filters.conversationId
            ? `AND conversation_id = ${filters.conversationId}`
            : ""
        }
        ${filters.userId ? `AND user_id = ${filters.userId}` : ""}
        GROUP BY DATE(created_at), operation_type
        ORDER BY date DESC
      `,
      ]);

    // Process daily usage data
    const dailyUsageMap = new Map<string, any>();
    (dailyUsage as any[]).forEach((row: any) => {
      const dateStr = row.date.toISOString().split("T")[0];
      if (!dailyUsageMap.has(dateStr)) {
        dailyUsageMap.set(dateStr, {
          date: dateStr,
          totalCost: 0,
          totalTokens: 0,
          operationCounts: {},
        });
      }
      const dayData = dailyUsageMap.get(dateStr);
      dayData.totalCost += parseFloat(row.total_cost || 0);
      dayData.totalTokens += parseInt(row.total_tokens || 0);
      dayData.operationCounts[row.operation_type] = parseInt(row.count || 0);
    });

    return {
      totalCost: totalStats._sum.totalCost || 0,
      totalTokens: totalStats._sum.totalTokens || 0,
      totalInputTokens: totalStats._sum.inputTokens || 0,
      totalOutputTokens: totalStats._sum.outputTokens || 0,
      operationBreakdown: operationBreakdown.map((op: any) => ({
        operationType: op.operationType,
        count: op._count.id,
        totalCost: op._sum.totalCost || 0,
        totalTokens: op._sum.totalTokens || 0,
      })),
      modelBreakdown: modelBreakdown.map((model: any) => ({
        model: model.model,
        count: model._count.id,
        totalCost: model._sum.totalCost || 0,
        totalTokens: model._sum.totalTokens || 0,
      })),
      dailyUsage: Array.from(dailyUsageMap.values()).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    };
  }

  /**
   * Get usage for a specific conversation
   */
  async getConversationUsage(conversationId: string): Promise<UsageAnalytics> {
    return this.getUsageAnalytics({ conversationId });
  }

  /**
   * Get usage for a specific user
   */
  async getUserUsage(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<UsageAnalytics> {
    const filters: UsageFilters = { userId };
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    return this.getUsageAnalytics(filters);
  }

  /**
   * Get recent usage records with pagination
   */
  async getRecentUsage(
    limit: number = 50,
    offset: number = 0,
    filters: UsageFilters = {}
  ): Promise<any[]> {
    const whereClause: any = {};

    if (filters.conversationId)
      whereClause.conversationId = filters.conversationId;
    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.operationType)
      whereClause.operationType = filters.operationType;
    if (filters.model) whereClause.model = filters.model;
    if (filters.success !== undefined) whereClause.success = filters.success;
    if (filters.startDate || filters.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) whereClause.createdAt.gte = filters.startDate;
      if (filters.endDate) whereClause.createdAt.lte = filters.endDate;
    }

    return this.prisma.usageTracking.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        conversation: {
          select: { id: true, title: true },
        },
        message: {
          select: { id: true, role: true, content: true },
        },
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  /**
   * Helper method to format usage data for display
   */
  formatUsageForDisplay(usage: any): string {
    return `${usage.operationType} (${usage.model}): ${CostService.formatTokens(
      usage.totalTokens
    )} - ${CostService.formatCost(usage.totalCost)}`;
  }
}
