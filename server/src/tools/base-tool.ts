import {
  ITool,
  ToolConfig,
  ToolParameter,
  ToolDefinition,
  ToolResult,
  ToolExecutionOptions,
  ToolUsageMetrics,
  ToolContext,
} from "../types/tool";
import { PrismaClient } from "@prisma/client";

// Circuit breaker states
enum CircuitState {
  CLOSED = "closed", // Normal operation
  OPEN = "open", // Circuit is open, failing fast
  HALF_OPEN = "half_open", // Testing if service is back
}

// Circuit breaker for each tool
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;

  constructor(
    private failureThreshold: number = 5,
    private recoveryTimeout: number = 60000, // 1 minute
    private successThreshold: number = 3
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.recoveryTimeout) {
        throw new Error("Circuit breaker is OPEN - service unavailable");
      }
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

export abstract class BaseTool implements ITool {
  protected prisma: PrismaClient;
  protected usageMetrics: Map<string, ToolUsageMetrics> = new Map();
  private circuitBreaker: CircuitBreaker;

  constructor(
    public readonly config: ToolConfig,
    public readonly parameters: ToolParameter[],
    prisma?: PrismaClient
  ) {
    this.prisma = prisma || new PrismaClient();
    // Initialize circuit breaker with configurable thresholds
    this.circuitBreaker = new CircuitBreaker(
      config.failureThreshold || 5,
      config.recoveryTimeout || 60000,
      config.successThreshold || 3
    );
  }

  // Abstract method that must be implemented by concrete tools
  abstract executeInternal(
    input: any,
    context?: ToolContext
  ): Promise<ToolResult>;

  // Generate OpenAI function definition from tool configuration
  get definition(): ToolDefinition {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    this.parameters.forEach((param) => {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      };

      // Add items for array types
      if (param.type === "array" && param.items) {
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
      type: "function",
      function: {
        name: this.config.name,
        description: this.config.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  }

  // Enhanced execution method with resilience patterns
  async execute(
    input: any,
    options: ToolExecutionOptions = {}
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const context = options.context || {};
    const maxRetries = options.maxRetries || this.config.maxRetries || 3;
    const retryDelay = options.retryDelay || this.config.retryDelay || 1000;

    // Validate input if requested
    if (options.validateInput !== false) {
      const isValid = await this.validate(input);
      if (!isValid) {
        return {
          success: false,
          error: "Invalid input parameters",
          duration: Date.now() - startTime,
        };
      }
    }

    // Execute with circuit breaker and retry logic
    return this.executeWithResilience(
      input,
      context,
      options,
      maxRetries,
      retryDelay,
      startTime
    );
  }

  // Resilient execution with circuit breaker, retries, and graceful degradation
  private async executeWithResilience(
    input: any,
    context: ToolContext,
    options: ToolExecutionOptions,
    maxRetries: number,
    retryDelay: number,
    startTime: number
  ): Promise<ToolResult> {
    let lastError: Error;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Execute with circuit breaker protection
        const result = await this.circuitBreaker.execute(async () => {
          return await this.executeWithTimeout(input, context, options);
        });

        const duration = Date.now() - startTime;
        result.duration = duration;

        // Track successful usage
        if (options.trackUsage !== false) {
          await this.trackUsage(result.success, duration, context);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        attempt++;

        // Check if this is a circuit breaker error (don't retry circuit breaker failures)
        if (lastError.message.includes("Circuit breaker is OPEN")) {
          return this.handleCircuitBreakerOpen(
            input,
            context,
            lastError,
            startTime,
            options
          );
        }

        // Don't retry on final attempt
        if (attempt > maxRetries) {
          break;
        }

        // Exponential backoff delay
        const delay = retryDelay * Math.pow(2, attempt - 1);
        console.warn(
          `🔄 Tool ${this.config.name} attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // All retries exhausted - handle graceful degradation
    return this.handleFailureWithGracefulDegradation(
      input,
      context,
      lastError!,
      startTime,
      options,
      maxRetries
    );
  }

  // Execute with timeout protection
  private async executeWithTimeout(
    input: any,
    context: ToolContext,
    options: ToolExecutionOptions
  ): Promise<ToolResult> {
    const timeout = options.timeout || this.config.timeout || 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Tool execution timeout")), timeout);
    });

    const executionPromise = this.executeInternal(input, context);
    return await Promise.race([executionPromise, timeoutPromise]);
  }

  // Handle circuit breaker open state with potential fallback
  private async handleCircuitBreakerOpen(
    input: any,
    context: ToolContext,
    error: Error,
    startTime: number,
    options: ToolExecutionOptions
  ): Promise<ToolResult> {
    const duration = Date.now() - startTime;

    // Track circuit breaker failure
    if (options.trackUsage !== false) {
      await this.trackUsage(false, duration, context, error.message);
    }

    // Try fallback if available
    if (this.config.fallbackEnabled && this.hasFallback()) {
      console.log(
        `🔄 Circuit breaker open for ${this.config.name}, attempting fallback...`
      );
      return await this.executeFallback(input, context, duration);
    }

    return {
      success: false,
      error: `Service temporarily unavailable: ${error.message}`,
      duration,
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  // Handle final failure with graceful degradation
  private async handleFailureWithGracefulDegradation(
    input: any,
    context: ToolContext,
    error: Error,
    startTime: number,
    options: ToolExecutionOptions,
    maxRetries: number
  ): Promise<ToolResult> {
    const duration = Date.now() - startTime;

    // Track final failure
    if (options.trackUsage !== false) {
      await this.trackUsage(false, duration, context, error.message);
    }

    // Try fallback as last resort
    if (this.config.fallbackEnabled && this.hasFallback()) {
      console.log(
        `🔄 All retries failed for ${this.config.name}, attempting fallback...`
      );
      return await this.executeFallback(input, context, duration);
    }

    // Return graceful error with helpful information
    return {
      success: false,
      error: `Tool failed after ${maxRetries + 1} attempts: ${error.message}`,
      duration,
      retries: maxRetries,
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  // Check if tool has fallback implementation
  protected hasFallback(): boolean {
    return false; // Override in specific tools that have fallbacks
  }

  // Execute fallback logic (override in specific tools)
  protected async executeFallback(
    input: any,
    context: ToolContext,
    baseDuration: number
  ): Promise<ToolResult> {
    return {
      success: false,
      error: "Fallback not implemented for this tool",
      duration: baseDuration,
    };
  }

  // Validate input parameters against tool schema
  async validate(input: any): Promise<boolean> {
    try {
      // Basic validation - check required parameters
      for (const param of this.parameters) {
        if (
          param.required &&
          (input[param.name] === undefined || input[param.name] === null)
        ) {
          return false;
        }

        // Type validation
        if (input[param.name] !== undefined) {
          const actualType = typeof input[param.name];
          if (param.type === "array" && !Array.isArray(input[param.name])) {
            return false;
          } else if (param.type !== "array" && actualType !== param.type) {
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
            status: success ? "COMPLETED" : "FAILED",
            error: error || null,
            duration,
          },
        });
      }

      // Update in-memory metrics
      const key = `${this.config.name}:${context.sessionId || "global"}`;
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
      console.error("Failed to track tool usage:", error);
    }
  }

  // Get usage metrics for this tool
  async getUsageMetrics(): Promise<ToolUsageMetrics> {
    const globalKey = `${this.config.name}:global`;
    return (
      this.usageMetrics.get(globalKey) || {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageDuration: 0,
        lastUsed: new Date(),
        errorRate: 0,
      }
    );
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    // Override in subclasses if needed
  }
}
