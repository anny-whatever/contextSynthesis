// Base tool result interface
export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
  duration?: number;
}

// Tool execution context
export interface ToolContext {
  conversationId?: string;
  messageId?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

// Tool configuration interface
export interface ToolConfig {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  timeout?: number;
  retries?: number;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}

// Tool parameter schema
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
  examples?: any[];
  items?: {
    type: 'string' | 'number' | 'boolean' | 'object';
    description?: string;
  };
}

// Tool definition for OpenAI function calling
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// Tool usage tracking
export interface ToolUsageMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageDuration: number;
  lastUsed: Date;
  errorRate: number;
}

// Tool execution options
export interface ToolExecutionOptions {
  timeout?: number;
  retries?: number;
  context?: ToolContext;
  validateInput?: boolean;
  trackUsage?: boolean;
}

// Abstract base tool interface
export interface ITool {
  readonly config: ToolConfig;
  readonly parameters: ToolParameter[];
  readonly definition: ToolDefinition;
  
  execute(input: any, options?: ToolExecutionOptions): Promise<ToolResult>;
  validate(input: any): Promise<boolean>;
  getUsageMetrics(): Promise<ToolUsageMetrics>;
}