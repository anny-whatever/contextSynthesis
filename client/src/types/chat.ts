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

export interface Summary {
  id: string;
  conversationId: string;
  topicName: string;
  summaryText: string;
  relatedTopics?: string[];
  messageRange: {
    startMessageId: string;
    endMessageId: string;
    messageCount: number;
  };
  summaryLevel: number;
  topicRelevance: number;
  batchId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntentAnalysis {
  id: string;
  conversationId: string;
  userMessageId: string;
  currentIntent: string;
  contextualRelevance: number;
  relationshipToHistory: string;
  keyTopics: string[];
  pendingQuestions: string[];
  lastAssistantQuestion?: string;
  analysisResult: any;
  createdAt: Date;
  updatedAt: Date;
  userMessage?: {
    content: string;
    createdAt: Date;
  };
}

export interface TokenData {
  conversationId: string;
  totalTokens: number;
  messageCount: number;
  breakdown: {
    userTokens: number;
    assistantTokens: number;
    systemTokens: number;
    toolTokens: number;
  };
}