export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export class CostService {
  // GPT-4o-mini pricing per million tokens
  private static readonly GPT_4O_MINI_INPUT_COST_PER_MILLION = 0.15;
  private static readonly GPT_4O_MINI_OUTPUT_COST_PER_MILLION = 0.60;

  /**
   * Calculate cost for GPT-4o-mini model
   */
  static calculateGPT4oMiniCost(usage: TokenUsage): CostCalculation {
    const inputCost = (usage.inputTokens / 1_000_000) * this.GPT_4O_MINI_INPUT_COST_PER_MILLION;
    const outputCost = (usage.outputTokens / 1_000_000) * this.GPT_4O_MINI_OUTPUT_COST_PER_MILLION;
    
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      inputCost: Number(inputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      totalCost: Number((inputCost + outputCost).toFixed(6))
    };
  }

  /**
   * Calculate cost for any model (extensible for future models)
   */
  static calculateCost(model: string, usage: TokenUsage): CostCalculation {
    switch (model) {
      case 'gpt-4o-mini':
        return this.calculateGPT4oMiniCost(usage);
      default:
        // Default to GPT-4o-mini pricing for unknown models
        console.warn(`Unknown model ${model}, using GPT-4o-mini pricing`);
        return this.calculateGPT4oMiniCost(usage);
    }
  }

  /**
   * Format cost for display (e.g., "$0.000123")
   */
  static formatCost(cost: number): string {
    if (cost < 0.000001) {
      return '$0.000000';
    }
    return `$${cost.toFixed(6)}`;
  }

  /**
   * Format token count for display (e.g., "1,234 tokens")
   */
  static formatTokens(tokens: number): string {
    return `${tokens.toLocaleString()} tokens`;
  }
}