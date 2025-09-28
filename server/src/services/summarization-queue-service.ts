export class SummarizationQueueService {
  private static instance: SummarizationQueueService;
  private activeSummarizations = new Map<string, Promise<void>>();
  private summarizationLocks = new Set<string>();

  private constructor() {}

  static getInstance(): SummarizationQueueService {
    if (!SummarizationQueueService.instance) {
      SummarizationQueueService.instance = new SummarizationQueueService();
    }
    return SummarizationQueueService.instance;
  }

  /**
   * Check if summarization is currently ongoing for a conversation
   */
  isSummarizationActive(conversationId: string): boolean {
    return this.summarizationLocks.has(conversationId);
  }

  /**
   * Wait for any ongoing summarization to complete for a conversation
   */
  async waitForSummarization(conversationId: string): Promise<void> {
    const activePromise = this.activeSummarizations.get(conversationId);
    if (activePromise) {
      console.log(`⏳ [QUEUE] Waiting for summarization to complete for conversation: ${conversationId}`);
      try {
        await activePromise;
      } catch (error) {
        // Ignore errors from previous summarization - we just need to wait for it to finish
        console.log(`⚠️ [QUEUE] Previous summarization failed but completed for conversation: ${conversationId}`);
      }
    }
  }

  /**
   * Start a summarization process and track it
   */
  async startSummarization(
    conversationId: string,
    summarizationFn: () => Promise<any>
  ): Promise<void> {
    // Check if already running
    if (this.summarizationLocks.has(conversationId)) {
      console.log(`🔒 [QUEUE] Summarization already active for conversation: ${conversationId}`);
      return;
    }

    // Set lock
    this.summarizationLocks.add(conversationId);
    console.log(`🚀 [QUEUE] Starting background summarization for conversation: ${conversationId}`);

    // Create and track the promise
    const summarizationPromise = this.executeSummarization(conversationId, summarizationFn);
    this.activeSummarizations.set(conversationId, summarizationPromise);

    // Don't await - this runs in background
    summarizationPromise.finally(() => {
      // Clean up when done
      this.summarizationLocks.delete(conversationId);
      this.activeSummarizations.delete(conversationId);
    });
  }

  private async executeSummarization(
    conversationId: string,
    summarizationFn: () => Promise<any>
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const result = await summarizationFn();
      const duration = Date.now() - startTime;
      
      console.log(`✅ [QUEUE] Background summarization completed for conversation: ${conversationId}`, {
        duration: `${duration}ms`,
        topicCount: result?.summaries?.length || 0,
        batchId: result?.batchId
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [QUEUE] Background summarization failed for conversation: ${conversationId}`, {
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - background process shouldn't affect user experience
    }
  }

  /**
   * Get status information for debugging
   */
  getStatus(): {
    activeSummarizations: string[];
    lockedConversations: string[];
  } {
    return {
      activeSummarizations: Array.from(this.activeSummarizations.keys()),
      lockedConversations: Array.from(this.summarizationLocks),
    };
  }
}