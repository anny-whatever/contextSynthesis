export interface Message {
  id?: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  timestamp: Date;
  toolUsages?: ToolUsage[];
}

export interface ToolUsage {
  toolName: string;
  input: any;
  output: any;
  success: boolean;
  duration: number;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
  messages?: Message[];
}

export interface ChatResponse {
  success: boolean;
  data: {
    message: string;
    conversationId: string;
    timestamp: string;
    toolsUsed: ToolUsage[];
    context: any;
    metadata: {
      model: string;
      tokensUsed?: number;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      duration: number;
      timestamp: string;
    };
  };
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  userId?: string;
  context?: Record<string, any>;
}