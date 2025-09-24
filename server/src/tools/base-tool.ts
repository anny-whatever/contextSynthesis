import { ITool, ToolConfig, ToolParameter, ToolDefinition, ToolResult, ToolExecutionOptions, ToolUsageMetrics, ToolContext } from '../types/tool';
import { PrismaClient } from '@prisma/client';

export abstract class BaseTool implements ITool {
  protected prisma: PrismaClient;
  protected usageMetrics: Map<string, ToolUsageMetrics> = new Map();

  constructor(
    public readonly config: ToolConfig,
    public readonly parameters: ToolParameter[],
    prisma?: PrismaClient
  ) {
    this.prisma = prisma || new PrismaClient();
  }

  // Abstract method that must be implemented by concrete tools
  abstract executeInternal(input: any, context?: ToolContext): Promise<ToolResult>;

  // Generate OpenAI function definition from tool configuration
  get definition(): ToolDefinition {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    this.parameters.forEach(param => {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      };

      // Add items for array types
      if (param.type === 'array' && param.items) {
        properties[param.name].items = param.items;
      }

      if (param.examples) {
        properties[param.name].examples = param.examples;
      }

      if (param.default !== undefined) {
        properties[param.name].default = param.default;
      }

      if (param.required) {
        required.push(param.name);
      }
    });

    return {
      type: 'function',
      function: {
        name: this.config.name,
        description: this.config.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  }

  // Main execution method with error handling, validation, and tracking
  async execute(input: any, options: ToolExecutionOptions = {}): Promise<ToolResult> {
    const startTime = Date.now();
    const context = options.context || {};
    
    try {
      // Validate input if requested
      if (options.validateInput !== false) {
        const isValid = await this.validate(input);
        if (!isValid) {
          return {
            success: false,
            error: 'Invalid input parameters',
            duration: Date.now() - startTime,
          };
        }
      }

      // Set timeout
      const timeout = options.timeout || this.config.timeout || 30000;
      const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout);
      });

      // Execute with timeout
      const executionPromise = this.executeInternal(input, context);
      const result = await Promise.race([executionPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      result.duration = duration;

      // Track usage if enabled
      if (options.trackUsage !== false) {
        await this.trackUsage(result.success, duration, context);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Track failed usage
      if (options.trackUsage !== false) {
        await this.trackUsage(false, duration, context, errorMessage);
      }

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  // Validate input parameters against tool schema
  async validate(input: any): Promise<boolean> {
    try {
      // Basic validation - check required parameters
      for (const param of this.parameters) {
        if (param.required && (input[param.name] === undefined || input[param.name] === null)) {
          return false;
        }

        // Type validation
        if (input[param.name] !== undefined) {
          const actualType = typeof input[param.name];
          if (param.type === 'array' && !Array.isArray(input[param.name])) {
            return false;
          } else if (param.type !== 'array' && actualType !== param.type) {
            return false;
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  // Track tool usage in database
  private async trackUsage(
    success: boolean,
    duration: number,
    context: ToolContext,
    error?: string
  ): Promise<void> {
    try {
      if (context.messageId) {
        await this.prisma.toolUsage.create({
          data: {
            messageId: context.messageId,
            toolName: this.config.name,
            input: context.metadata || {},
            output: success ? { success: true } : { success: false, error },
            status: success ? 'COMPLETED' : 'FAILED',
            error: error || null,
            duration,
          },
        });
      }

      // Update in-memory metrics
      const key = `${this.config.name}:${context.sessionId || 'global'}`;
      const metrics = this.usageMetrics.get(key) || {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageDuration: 0,
        lastUsed: new Date(),
        errorRate: 0,
      };

      metrics.totalCalls++;
      if (success) {
        metrics.successfulCalls++;
      } else {
        metrics.failedCalls++;
      }
      metrics.averageDuration = (metrics.averageDuration + duration) / 2;
      metrics.lastUsed = new Date();
      metrics.errorRate = metrics.failedCalls / metrics.totalCalls;

      this.usageMetrics.set(key, metrics);
    } catch (error) {
      console.error('Failed to track tool usage:', error);
    }
  }

  // Get usage metrics for this tool
  async getUsageMetrics(): Promise<ToolUsageMetrics> {
    const globalKey = `${this.config.name}:global`;
    return this.usageMetrics.get(globalKey) || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageDuration: 0,
      lastUsed: new Date(),
      errorRate: 0,
    };
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    // Override in subclasses if needed
  }
}