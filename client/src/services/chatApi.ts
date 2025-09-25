import type { ChatRequest, ChatResponse, Conversation, Message, Summary, IntentAnalysis } from '../types/chat';

const API_BASE_URL = 'http://localhost:3001/api';

export class ChatApiService {
  private static async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  static async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  static async createConversation(title?: string, userId?: string): Promise<{ success: boolean; data: Conversation }> {
    return this.request<{ success: boolean; data: Conversation }>('/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, userId }),
    });
  }

  static async getConversationMessages(
    conversationId: string,
    limit = 50,
    offset = 0
  ): Promise<{ success: boolean; data: { messages: Message[]; pagination: any } }> {
    return this.request<{ success: boolean; data: { messages: Message[]; pagination: any } }>(
      `/chat/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`
    );
  }

  static async getConversation(conversationId: string): Promise<{ success: boolean; data: Conversation }> {
    return this.request<{ success: boolean; data: Conversation }>(`/chat/conversations/${conversationId}`);
  }

  static async getUserConversations(
    userId: string,
    limit = 10,
    offset = 0
  ): Promise<{ success: boolean; data: { conversations: Conversation[]; pagination: any } }> {
    return this.request<{ success: boolean; data: { conversations: Conversation[]; pagination: any } }>(
      `/chat/user/${userId}/conversations?limit=${limit}&offset=${offset}`
    );
  }

  static async deleteConversation(conversationId: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/chat/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  }

  static async getConversationSummaries(
    conversationId: string,
    limit = 10,
    offset = 0
  ): Promise<{ success: boolean; data: { summaries: Summary[]; pagination: any } }> {
    return this.request<{ success: boolean; data: { summaries: Summary[]; pagination: any } }>(
      `/chat/conversations/${conversationId}/summaries?limit=${limit}&offset=${offset}`
    );
  }

  static async getConversationIntentAnalyses(
    conversationId: string,
    limit = 10,
    offset = 0
  ): Promise<{ success: boolean; data: { intentAnalyses: IntentAnalysis[]; pagination: any } }> {
    return this.request<{ success: boolean; data: { intentAnalyses: IntentAnalysis[]; pagination: any } }>(
      `/chat/conversations/${conversationId}/intent-analyses?limit=${limit}&offset=${offset}`
    );
  }

  // New methods for pinging mechanism
  static async getLatestIntentAnalysis(
    conversationId: string
  ): Promise<{ success: boolean; data: { intentAnalyses: IntentAnalysis[]; pagination: any } }> {
    return this.request<{ success: boolean; data: { intentAnalyses: IntentAnalysis[]; pagination: any } }>(
      `/chat/conversations/${conversationId}/intent-analyses?limit=1`
    );
  }

  static async getLatestSummaries(
    conversationId: string,
    limit = 5
  ): Promise<{ success: boolean; data: { summaries: Summary[]; total: number } }> {
    return this.request<{ success: boolean; data: { summaries: Summary[]; total: number } }>(
      `/chat/conversations/${conversationId}/summaries?limit=${limit}`
    );
  }
}