export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface WebSearchUsage {
  searchCalls: number;
  model?: string;
}

export interface EmbeddingUsage {
  inputTokens: number;
  model: string;
}

export interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  webSearchCalls?: number;
  webSearchCost?: number;
  embeddingTokens?: number;
  embeddingCost?: number;
}

export class CostService {
  // GPT-4o-mini pricing per million tokens
  private static readonly GPT_4O_MINI_INPUT_COST_PER_MILLION = 0.15;
  private static readonly GPT_4O_MINI_OUTPUT_COST_PER_MILLION = 0.6;

  // Embedding pricing per million tokens
  private static readonly EMBEDDING_COST_PER_MILLION: Record<string, number> = {
    "text-embedding-3-small": 0.02,
    "text-embedding-3-large": 0.13,
    "text-embedding-ada-002": 0.10,
    default: 0.02, // Default to text-embedding-3-small pricing
  };

  // Web search tool call pricing per 1000 calls
  private static readonly WEB_SEARCH_COST_PER_1K_CALLS: Record<string, number> =
    {
      "gpt-4o": 10.0,
      "gpt-4.1": 10.0,
      "gpt-4o-mini": 10.0,
      "gpt-4.1-mini": 10.0,
      "gpt-5": 10.0,
      o1: 10.0,
      "o1-mini": 10.0,
      o3: 10.0,
      "o3-mini": 10.0,
      default: 10.0, // Default for unknown models
    };

  /**
   * Calculate cost for GPT-4o-mini model
   */
  static calculateGPT4oMiniCost(usage: TokenUsage): CostCalculation {
    const inputCost =
      (usage.inputTokens / 1_000_000) * this.GPT_4O_MINI_INPUT_COST_PER_MILLION;
    const outputCost =
      (usage.outputTokens / 1_000_000) *
      this.GPT_4O_MINI_OUTPUT_COST_PER_MILLION;

    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      inputCost: Number(inputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      totalCost: Number((inputCost + outputCost).toFixed(6)),
    };
  }

  /**
   * Calculate web search tool call cost
   */
  static calculateWebSearchCost(usage: WebSearchUsage): number {
    const model = usage.model || "default";
    const costPer1K =
      this.WEB_SEARCH_COST_PER_1K_CALLS[model] ??
      this.WEB_SEARCH_COST_PER_1K_CALLS["default"]!;
    const cost = (usage.searchCalls / 1000) * costPer1K;
    return Number(cost.toFixed(6));
  }

  /**
   * Calculate embedding cost
   */
  static calculateEmbeddingCost(usage: EmbeddingUsage): number {
    const costPerMillion =
      this.EMBEDDING_COST_PER_MILLION[usage.model] ??
      this.EMBEDDING_COST_PER_MILLION["default"]!;
    const cost = (usage.inputTokens / 1_000_000) * costPerMillion;
    return Number(cost.toFixed(6));
  }

  /**
   * Calculate cost for any model (extensible for future models)
   */
  static calculateCost(
    model: string,
    usage: TokenUsage,
    webSearchUsage?: WebSearchUsage,
    embeddingUsage?: EmbeddingUsage
  ): CostCalculation {
    let baseCost: CostCalculation;

    switch (model) {
      case "gpt-4o-mini":
        baseCost = this.calculateGPT4oMiniCost(usage);
        break;
      default:
        // Default to GPT-4o-mini pricing for unknown models
        console.warn(`Unknown model ${model}, using GPT-4o-mini pricing`);
        baseCost = this.calculateGPT4oMiniCost(usage);
    }

    // Add web search costs if provided
    if (webSearchUsage && webSearchUsage.searchCalls > 0) {
      const webSearchCost = this.calculateWebSearchCost(webSearchUsage);
      baseCost.webSearchCalls = webSearchUsage.searchCalls;
      baseCost.webSearchCost = webSearchCost;
      baseCost.totalCost = Number(
        (baseCost.totalCost + webSearchCost).toFixed(6)
      );
    }

    // Add embedding costs if provided
    if (embeddingUsage && embeddingUsage.inputTokens > 0) {
      const embeddingCost = this.calculateEmbeddingCost(embeddingUsage);
      baseCost.embeddingTokens = embeddingUsage.inputTokens;
      baseCost.embeddingCost = embeddingCost;
      baseCost.totalCost = Number(
        (baseCost.totalCost + embeddingCost).toFixed(6)
      );
    }

    return baseCost;
  }

  /**
   * Format cost for display (e.g., "$0.000123")
   */
  static formatCost(cost: number): string {
    if (cost < 0.000001) {
      return "$0.000000";
    }
    return `$${cost.toFixed(6)}`;
  }

  /**
   * Format token count for display (e.g., "1,234 tokens")
   */
  static formatTokens(tokens: number): string {
    return `${tokens.toLocaleString()} tokens`;
  }

  /**
   * Format web search calls for display (e.g., "5 searches")
   */
  static formatWebSearchCalls(calls: number): string {
    return `${calls} search${calls === 1 ? "" : "es"}`;
  }

  /**
   * Format embedding tokens for display (e.g., "1,234 embedding tokens")
   */
  static formatEmbeddingTokens(tokens: number): string {
    return `${tokens.toLocaleString()} embedding tokens`;
  }
}
