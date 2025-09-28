import { Role } from '@prisma/client';

export interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
  systemPrompt: string;
  enableTools: boolean;
  maxConversationHistory: number;
  enableDetailedToolLogging?: boolean;
}

export interface ConversationContext {
  conversationId?: string;
  userId: string;
  messageHistory: MessageContext[];
  metadata: Record<string, any>;
}

export interface MessageContext {
  id?: string;
  role: Role;
  content: string;
  timestamp: Date;
  toolUsages?: ToolUsageContext[];
  isSummary?: boolean;
}

export interface ToolUsageContext {
  toolName: string;
  input: any;
  output: any;
  success: boolean;
  duration: number;
  error?: string | undefined;
}

export interface AgentResponse {
  message: string;
  conversationId: string;
  toolsUsed: ToolUsageContext[];
  context: ConversationContext;
  intentAnalysis?: {
    currentIntent: string;
    contextualRelevance: "high" | "medium" | "low";
    relationshipToHistory: "continuation" | "new_topic" | "clarification" | "recall";
    keyTopics: string[];
    needsHistoricalContext: boolean;
    contextRetrievalStrategy: string;
    confidenceLevel: "high" | "medium" | "low";
    confidenceScore: number;
  };
  reasoning?: {
    actionsPerformed: string[];
    contextUsed: string;
    decisionProcess: string;
  };
  metadata: {
    model: string;
    tokensUsed?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    duration: number;
    timestamp: Date;
  };
}

export interface AgentRequest {
  message: string;
  conversationId?: string;
  userId?: string;
  context?: Record<string, any>;
  options?: {
    enableTools?: boolean;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface AgentSession {
  id: string;
  userId: string;
  conversationId: string;
  startTime: Date;
  endTime?: Date;
  messageCount: number;
  toolUsageCount: number;
  status: 'active' | 'completed' | 'error';
  metadata: Record<string, any>;
}