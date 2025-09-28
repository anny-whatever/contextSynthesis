export interface ToolExecutionContext {
  toolName: string;
  purpose: string;
  userQuery: string;
  searchStrategy: string;
  timestamp: string;
  confidence: number;
  totalFound: number;
  searchQueries: string[];
  interpretationGuide: string;
  executionReason: string;
}

export interface ToolResultMetadata {
  executionTime: number;
  success: boolean;
  resultCount: number;
  confidence?: number;
  searchQueries?: string[];
  dateRange?: {
    startDate: string;
    endDate: string;
    includeHours: boolean;
  };
  totalAvailable?: number;
  hasMoreResults?: boolean;
  warning?: string;
}

export interface ContextualizedToolResult {
  context: ToolExecutionContext;
  metadata: ToolResultMetadata;
  rawResult: any;
  formattedExplanation: string;
  usageInstructions: string;
}

export interface ToolCallReasoning {
  intentAnalysis: {
    userIntent: string;
    keyTopics: string[];
    temporalReferences: string[];
    needsHistoricalContext: boolean;
  };
  toolSelection: {
    selectedTool: string;
    reason: string;
    alternativeTools: string[];
    confidence: number;
  };
  searchStrategy: {
    strategy: string;
    queries: string[];
    parameters: Record<string, any>;
    expectedResults: string;
  };
}

export interface SystemPromptSection {
  title: string;
  content: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  order: number;
}

export interface StructuredSystemPrompt {
  identity: SystemPromptSection;
  toolContext: SystemPromptSection[];
  conversationContext: SystemPromptSection;
  responseGuidelines: SystemPromptSection;
  confidenceAssessment?: SystemPromptSection;
}