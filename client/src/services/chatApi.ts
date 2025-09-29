import type {
  ChatRequest,
  ChatResponse,
  Conversation,
  Message,
  Summary,
  IntentAnalysis,
  TokenData,
} from "../types/chat";

// Streaming event types
export interface StreamingEvent {
  type:
    | "connection"
    | "tool_start"
    | "tool_complete"
    | "tool_error"
    | "message_chunk"
    | "message_complete"
    | "error";
  data: any;
  timestamp: string;
}

export interface StreamingOptions {
  onEvent: (event: StreamingEvent) => void;
  onComplete: (response: ChatResponse) => void;
  onError: (error: Error) => void;
}

const API_BASE_URL = "http://localhost:3001/api";

export class ChatApiService {
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

  static async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>("/chat", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // Streaming version of sendMessage using Server-Sent Events
  static sendMessageStream(
    request: ChatRequest,
    options: StreamingOptions
  ): () => void {
    const url = `${API_BASE_URL}/chat/stream`;
    let eventSource: EventSource | null = null;

    // Start SSE connection
    const startStream = () => {
      // Create POST request first to initiate streaming
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // For SSE, we need to create a new GET request to receive events
          // But since we're using POST data, we'll handle this through a different approach
          // Let's read the response as a stream directly
          return this.handleStreamingResponse(response, options);
        })
        .catch((error) => {
          options.onError(error);
        });
    };

    // Start the stream
    setTimeout(startStream, 0);

    // Return cleanup function
    return () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }

  // Handle streaming response from fetch
  private static async handleStreamingResponse(
    response: Response,
    options: StreamingOptions
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      options.onError(new Error("No readable stream available"));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const eventData = JSON.parse(line.substring(6));
              const streamingEvent: StreamingEvent = {
                type: eventData.type,
                data: eventData.data,
                timestamp: eventData.timestamp,
              };

              options.onEvent(streamingEvent);

              // Handle completion event
              if (eventData.type === "message_complete") {
                const chatResponse: ChatResponse = {
                  success: true,
                  data: eventData.data,
                };
                options.onComplete(chatResponse);
                return;
              }

              // Handle error event
              if (eventData.type === "error") {
                options.onError(
                  new Error(eventData.data.message || "Unknown streaming error")
                );
                return;
              }
            } catch (parseError) {
              console.warn("Failed to parse SSE event:", line);
            }
          }
        }
      }
    } catch (error) {
      options.onError(
        error instanceof Error ? error : new Error("Stream reading error")
      );
    } finally {
      reader.releaseLock();
    }
  }

  static async createConversation(
    title?: string,
    userId?: string
  ): Promise<{ success: boolean; data: Conversation }> {
    return this.request<{ success: boolean; data: Conversation }>(
      "/chat/conversations",
      {
        method: "POST",
        body: JSON.stringify({ title, userId }),
      }
    );
  }

  static async getConversationMessages(
    conversationId: string,
    limit = 50,
    offset = 0
  ): Promise<{
    success: boolean;
    data: { messages: Message[]; pagination: any };
  }> {
    return this.request<{
      success: boolean;
      data: { messages: Message[]; pagination: any };
    }>(
      `/chat/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`
    );
  }

  static async getConversation(
    conversationId: string
  ): Promise<{ success: boolean; data: Conversation }> {
    return this.request<{ success: boolean; data: Conversation }>(
      `/chat/conversations/${conversationId}`
    );
  }

  static async getUserConversations(
    userId: string,
    limit = 10,
    offset = 0
  ): Promise<{
    success: boolean;
    data: { conversations: Conversation[]; pagination: any };
  }> {
    return this.request<{
      success: boolean;
      data: { conversations: Conversation[]; pagination: any };
    }>(`/chat/user/${userId}/conversations?limit=${limit}&offset=${offset}`);
  }

  static async deleteConversation(
    conversationId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      `/chat/conversations/${conversationId}`,
      {
        method: "DELETE",
      }
    );
  }

  static async getConversationSummaries(
    conversationId: string,
    limit = 10,
    offset = 0
  ): Promise<{
    success: boolean;
    data: { summaries: Summary[]; pagination: any };
  }> {
    return this.request<{
      success: boolean;
      data: { summaries: Summary[]; pagination: any };
    }>(
      `/chat/conversations/${conversationId}/summaries?limit=${limit}&offset=${offset}`
    );
  }

  static async getConversationIntentAnalyses(
    conversationId: string,
    limit = 10,
    offset = 0
  ): Promise<{
    success: boolean;
    data: { intentAnalyses: IntentAnalysis[]; pagination: any };
  }> {
    return this.request<{
      success: boolean;
      data: { intentAnalyses: IntentAnalysis[]; pagination: any };
    }>(
      `/chat/conversations/${conversationId}/intent-analyses?limit=${limit}&offset=${offset}`
    );
  }

  // New methods for pinging mechanism
  static async getLatestIntentAnalysis(conversationId: string): Promise<{
    success: boolean;
    data: { intentAnalyses: IntentAnalysis[]; pagination: any };
  }> {
    return this.request<{
      success: boolean;
      data: { intentAnalyses: IntentAnalysis[]; pagination: any };
    }>(`/chat/conversations/${conversationId}/intent-analyses?limit=1`);
  }

  static async getLatestSummaries(
    conversationId: string,
    limit = 5
  ): Promise<{
    success: boolean;
    data: { summaries: Summary[]; total: number };
  }> {
    return this.request<{
      success: boolean;
      data: { summaries: Summary[]; total: number };
    }>(`/chat/conversations/${conversationId}/summaries?limit=${limit}`);
  }

  static async getConversationTokens(
    conversationId: string
  ): Promise<{ success: boolean; data: TokenData }> {
    return this.request<{ success: boolean; data: TokenData }>(
      `/chat/conversations/${conversationId}/tokens`
    );
  }

  // Behavioral Memory methods
  static async getBehavioralMemory(conversationId: string): Promise<{
    success: boolean;
    data: {
      conversationId: string;
      behavioralMemory: string;
      wordCount: number;
    };
  }> {
    return this.request<{
      success: boolean;
      data: {
        conversationId: string;
        behavioralMemory: string;
        wordCount: number;
      };
    }>(`/chat/conversations/${conversationId}/behavioral-memory`);
  }

  static async updateBehavioralMemory(
    conversationId: string,
    behavioralMemory: string
  ): Promise<{
    success: boolean;
    data: {
      conversationId: string;
      behavioralMemory: string;
      wordCount: number;
      message: string;
    };
  }> {
    return this.request<{
      success: boolean;
      data: {
        conversationId: string;
        behavioralMemory: string;
        wordCount: number;
        message: string;
      };
    }>(`/chat/conversations/${conversationId}/behavioral-memory`, {
      method: "PUT",
      body: JSON.stringify({ behavioralMemory }),
    });
  }
}
