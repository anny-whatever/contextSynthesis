import { ITool, ToolDefinition, ToolResult, ToolExecutionOptions, ToolUsageMetrics } from '../types/tool';
import { WebSearchTool } from './web-search-tool';
import { SemanticTopicSearchTool } from './semantic-topic-search-tool';
import { TopicEmbeddingService } from '../services/topic-embedding-service';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();
  private prisma: PrismaClient;
  private openai: OpenAI;

  constructor(prisma?: PrismaClient, openai?: OpenAI) {
    this.prisma = prisma || new PrismaClient();
    this.openai = openai || new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.initializeDefaultTools();
  }

  /**
   * Initialize default tools that come with the system
   */
  private initializeDefaultTools(): void {
    // Register the web search tool
    const webSearchTool = new WebSearchTool(this.prisma);
    this.registerTool(webSearchTool);

    // Register the semantic topic search tool
    const embeddingService = new TopicEmbeddingService(this.openai, this.prisma);
    const semanticSearchTool = new SemanticTopicSearchTool(embeddingService, this.prisma);
    this.registerTool(semanticSearchTool);
  }

  /**
   * Register a new tool in the registry
   */
  registerTool(tool: ITool): void {
    if (this.tools.has(tool.config.name)) {
      throw new Error(`Tool with name '${tool.config.name}' is already registered`);
    }

    if (!tool.config.enabled) {
      console.warn(`Tool '${tool.config.name}' is disabled and will not be registered`);
      return;
    }

    this.tools.set(tool.config.name, tool);
    console.log(`Tool '${tool.config.name}' registered successfully`);
  }

  /**
   * Unregister a tool from the registry
   */
  unregisterTool(toolName: string): boolean {
    const removed = this.tools.delete(toolName);
    if (removed) {
      console.log(`Tool '${toolName}' unregistered successfully`);
    }
    return removed;
  }

  /**
   * Get a specific tool by name
   */
  getTool(toolName: string): ITool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all enabled tools
   */
  getEnabledTools(): ITool[] {
    return Array.from(this.tools.values()).filter(tool => tool.config.enabled);
  }

  /**
   * Get tool definitions for OpenAI function calling
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.getEnabledTools().map(tool => tool.definition);
  }

  /**
   * Execute a tool by name with given input
   */
  async executeTool(
    toolName: string,
    input: any,
    options?: ToolExecutionOptions
  ): Promise<ToolResult> {
    const tool = this.getTool(toolName);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found in registry`,
      };
    }

    if (!tool.config.enabled) {
      return {
        success: false,
        error: `Tool '${toolName}' is disabled`,
      };
    }

    try {
      return await tool.execute(input, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Tool execution failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get usage metrics for all tools
   */
  async getAllToolMetrics(): Promise<Record<string, ToolUsageMetrics>> {
    const metrics: Record<string, ToolUsageMetrics> = {};
    
    for (const [toolName, tool] of this.tools) {
      try {
        metrics[toolName] = await tool.getUsageMetrics();
      } catch (error) {
        console.error(`Failed to get metrics for tool '${toolName}':`, error);
        metrics[toolName] = {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          averageDuration: 0,
          lastUsed: new Date(),
          errorRate: 0,
        };
      }
    }
    
    return metrics;
  }

  /**
   * Get usage metrics for a specific tool
   */
  async getToolMetrics(toolName: string): Promise<ToolUsageMetrics | null> {
    const tool = this.getTool(toolName);
    if (!tool) {
      return null;
    }

    try {
      return await tool.getUsageMetrics();
    } catch (error) {
      console.error(`Failed to get metrics for tool '${toolName}':`, error);
      return null;
    }
  }

  /**
   * Check if a tool exists and is enabled
   */
  isToolAvailable(toolName: string): boolean {
    const tool = this.getTool(toolName);
    return tool !== undefined && tool.config.enabled;
  }

  /**
   * Get tool names that are currently available
   */
  getAvailableToolNames(): string[] {
    return this.getEnabledTools().map(tool => tool.config.name);
  }

  /**
   * Validate tool input before execution
   */
  async validateToolInput(toolName: string, input: any): Promise<boolean> {
    const tool = this.getTool(toolName);
    if (!tool) {
      return false;
    }

    try {
      return await tool.validate(input);
    } catch (error) {
      console.error(`Validation failed for tool '${toolName}':`, error);
      return false;
    }
  }

  /**
   * Enable a tool
   */
  enableTool(toolName: string): boolean {
    const tool = this.getTool(toolName);
    if (!tool) {
      return false;
    }

    // Note: This modifies the tool's config directly
    // In a production system, you might want to handle this differently
    (tool.config as any).enabled = true;
    console.log(`Tool '${toolName}' enabled`);
    return true;
  }

  /**
   * Disable a tool
   */
  disableTool(toolName: string): boolean {
    const tool = this.getTool(toolName);
    if (!tool) {
      return false;
    }

    // Note: This modifies the tool's config directly
    // In a production system, you might want to handle this differently
    (tool.config as any).enabled = false;
    console.log(`Tool '${toolName}' disabled`);
    return true;
  }

  /**
   * Get tool registry status
   */
  getRegistryStatus(): {
    totalTools: number;
    enabledTools: number;
    disabledTools: number;
    toolNames: string[];
  } {
    const allTools = this.getAllTools();
    const enabledTools = this.getEnabledTools();
    
    return {
      totalTools: allTools.length,
      enabledTools: enabledTools.length,
      disabledTools: allTools.length - enabledTools.length,
      toolNames: allTools.map(tool => tool.config.name),
    };
  }

  /**
   * Cleanup all tools
   */
  async cleanup(): Promise<void> {
    for (const tool of this.tools.values()) {
      try {
        if ('cleanup' in tool && typeof tool.cleanup === 'function') {
          await tool.cleanup();
        }
      } catch (error) {
        console.error(`Failed to cleanup tool '${tool.config.name}':`, error);
      }
    }
  }
}