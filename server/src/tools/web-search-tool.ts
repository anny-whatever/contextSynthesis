import { BaseTool } from "./base-tool";
import {
  ToolConfig,
  ToolParameter,
  ToolResult,
  ToolContext,
} from "../types/tool";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { CostService, WebSearchUsage } from "../services/cost-service";

interface WebSearchInput {
  query: string;
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string | undefined;
  source?: string | undefined;
}

interface WebSearchResponse {
  results: WebSearchResult[];
  query: string;
  total_results: number;
  search_time_ms: number;
}

export class WebSearchTool extends BaseTool {
  private openai: OpenAI;

  constructor(prisma?: PrismaClient) {
    const config: ToolConfig = {
      name: "web_search",
      description:
        "Search the web for current information and return relevant results with titles, URLs, and snippets",
      version: "1.0.0",
      enabled: true,
      timeout: 30000,
      retries: 2,
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000, // 1 minute
      },
    };

    const parameters: ToolParameter[] = [
      {
        name: "query",
        type: "string",
        description:
          "The search query to execute. Should be clear and specific.",
        required: true,
        examples: [
          "latest developments in AI technology 2024",
          "climate change effects on agriculture",
          "best practices for TypeScript development",
        ],
      },
      {
        name: "max_results",
        type: "number",
        description: "Maximum number of search results to return (1-20)",
        required: false,
        default: 10,
        examples: [5, 10, 15],
      },
      {
        name: "include_domains",
        type: "array",
        description: "Array of domains to include in search results",
        required: false,
        items: {
          type: "string",
          description: "Domain name (e.g., github.com)",
        },
        examples: [
          ["github.com", "stackoverflow.com"],
          ["news.com", "bbc.com"],
        ],
      },
      {
        name: "exclude_domains",
        type: "array",
        description: "Array of domains to exclude from search results",
        required: false,
        items: {
          type: "string",
          description: "Domain name (e.g., spam.com)",
        },
        examples: [["spam.com", "ads.com"], ["social-media.com"]],
      },
    ];

    super(config, parameters, prisma);

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async executeInternal(
    input: WebSearchInput,
    context?: ToolContext
  ): Promise<ToolResult<WebSearchResponse>> {
    try {
      const startTime = Date.now();

      // Validate max_results
      const maxResults = Math.min(Math.max(input.max_results || 10, 1), 20);

      // Prepare the search query
      let searchQuery = input.query.trim();

      // Add domain filters if specified
      if (input.include_domains && input.include_domains.length > 0) {
        const domainFilter = input.include_domains
          .map((domain) => `site:${domain}`)
          .join(" OR ");
        searchQuery += ` (${domainFilter})`;
      }

      if (input.exclude_domains && input.exclude_domains.length > 0) {
        const excludeFilter = input.exclude_domains
          .map((domain) => `-site:${domain}`)
          .join(" ");
        searchQuery += ` ${excludeFilter}`;
      }

      // Use OpenAI's web search capability through the Responses API
      const response = await this.openai.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        input: `Search for: "${searchQuery}". Return up to ${maxResults} results.`,
        tools: [
          {
            type: "web_search",
          },
        ],
      });

      const searchTime = Date.now() - startTime;

      // Calculate web search cost
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const webSearchUsage: WebSearchUsage = {
        searchCalls: 1, // Each API call counts as 1 search call
        model: model
      };
      const webSearchCost = CostService.calculateWebSearchCost(webSearchUsage);

      // Parse the response from Responses API
      const content = response.output_text;
      if (!content) {
        throw new Error("No search results returned from OpenAI");
      }

      // Extract search results from the response
      // The Responses API with web search returns formatted text with citations
      // We'll parse this into our structured format
      const searchResults: WebSearchResponse = {
        results: [],
        query: input.query,
        total_results: 0,
        search_time_ms: searchTime,
      };

      // For now, create a single result with the full response
      // In a real implementation, you might parse citations and sources
      searchResults.results = [
        {
          title: `Search Results for: ${input.query}`,
          url: "#search-results",
          snippet:
            content.substring(0, 500) + (content.length > 500 ? "..." : ""),
          source: "OpenAI Web Search",
        },
      ];
      searchResults.total_results = 1;

      // Ensure the response has the correct structure
      if (!searchResults.results || !Array.isArray(searchResults.results)) {
        throw new Error("Invalid search results format");
      }

      // Validate and clean results
      searchResults.results = searchResults.results
        .filter((result) => result.title && result.url && result.snippet)
        .slice(0, maxResults)
        .map((result) => ({
          title: result.title.trim(),
          url: result.url.trim(),
          snippet: result.snippet.trim(),
          published_date: result.published_date || undefined,
          source: result.source || new URL(result.url).hostname,
        }));

      searchResults.query = input.query;
      searchResults.total_results = searchResults.results.length;
      searchResults.search_time_ms = searchTime;

      return {
        success: true,
        data: searchResults,
        metadata: {
          query: input.query,
          max_results: maxResults,
          include_domains: input.include_domains,
          exclude_domains: input.exclude_domains,
          search_time_ms: searchTime,
          webSearchCost: webSearchCost,
          webSearchCalls: webSearchUsage.searchCalls,
          model: model
        },
        duration: searchTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during web search";

      return {
        success: false,
        error: errorMessage,
        metadata: {
          query: input.query,
          error_type:
            error instanceof Error ? error.constructor.name : "UnknownError",
        },
      };
    }
  }

  // Enhanced validation for web search specific parameters
  async validate(input: WebSearchInput): Promise<boolean> {
    // Call parent validation first
    const baseValid = await super.validate(input);
    if (!baseValid) return false;

    // Additional web search specific validation
    if (
      !input.query ||
      typeof input.query !== "string" ||
      input.query.trim().length === 0
    ) {
      return false;
    }

    if (input.max_results !== undefined) {
      if (
        typeof input.max_results !== "number" ||
        input.max_results < 1 ||
        input.max_results > 20
      ) {
        return false;
      }
    }

    if (input.include_domains !== undefined) {
      if (
        !Array.isArray(input.include_domains) ||
        !input.include_domains.every(
          (domain) => typeof domain === "string" && domain.length > 0
        )
      ) {
        return false;
      }
    }

    if (input.exclude_domains !== undefined) {
      if (
        !Array.isArray(input.exclude_domains) ||
        !input.exclude_domains.every(
          (domain) => typeof domain === "string" && domain.length > 0
        )
      ) {
        return false;
      }
    }

    return true;
  }
}
