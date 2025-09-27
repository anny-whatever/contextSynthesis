const API_BASE_URL = "http://localhost:3001/api";

export class AnalyticsApiService {
  private static async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message ||
          `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return response.json();
  }

  // Overview metrics
  static async getOverview(timeframe: string): Promise<any> {
    return this.request(`/analytics/overview?timeframe=${timeframe}`);
  }

  // Usage timeline data
  static async getUsageTimeline(timeframe: string): Promise<any> {
    return this.request(`/analytics/usage-timeline?timeframe=${timeframe}`);
  }

  // Usage by operation
  static async getUsageByOperation(timeframe: string): Promise<any> {
    return this.request(`/analytics/usage-by-operation?timeframe=${timeframe}`);
  }

  // Top users
  static async getTopUsers(
    timeframe: string,
    limit: number = 10
  ): Promise<any> {
    return this.request(
      `/analytics/top-users?timeframe=${timeframe}&limit=${limit}`
    );
  }

  // Error rates
  static async getErrorRates(timeframe: string): Promise<any> {
    return this.request(`/analytics/error-rates?timeframe=${timeframe}`);
  }

  // Per-message usage data
  static async getPerMessageUsage(
    timeframe: string,
    limit: number = 50
  ): Promise<any> {
    return this.request(
      `/analytics/per-message-usage?timeframe=${timeframe}&limit=${limit}`
    );
  }

  // Operation cost breakdown
  static async getOperationCostBreakdown(timeframe: string): Promise<any> {
    return this.request(
      `/analytics/operation-cost-breakdown?timeframe=${timeframe}`
    );
  }

  // Cumulative cost data
  static async getCumulativeCost(timeframe: string): Promise<any> {
    return this.request(
      `/analytics/cumulative-cost?timeframe=${timeframe}`
    );
  }

  static async getPerMessageOperationTimeline(timeframe: string = "7d") {
    const response = await fetch(`/api/analytics/per-message-operation-timeline?timeframe=${timeframe}`);
    if (!response.ok) {
      throw new Error("Failed to fetch per-message operation timeline data");
    }
    return response.json();
  }
}
