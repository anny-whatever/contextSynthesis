import { useEffect, useRef, useCallback, useState } from 'react';
import { ChatApiService } from '../services/chatApi';
import type { IntentAnalysis, Summary } from '../types/chat';

interface PingMechanismState {
  latestIntentAnalysis: IntentAnalysis | null;
  latestSummaries: Summary[];
  isActive: boolean;
  error: string | null;
}

interface PingMechanismOptions {
  conversationId: string | null;
  onUserMessage: () => void;
  onAssistantMessage: () => void;
  pingInterval?: number; // in milliseconds, default 500ms
  stopDelayAfterAssistant?: number; // in milliseconds, default 5000ms (5 seconds)
}

export function usePingMechanism({
  conversationId,
  onUserMessage,
  onAssistantMessage,
  pingInterval = 500,
  stopDelayAfterAssistant = 5000,
}: PingMechanismOptions) {
  const [state, setState] = useState<PingMechanismState>({
    latestIntentAnalysis: null,
    latestSummaries: [],
    isActive: false,
    error: null,
  });

  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIntentAnalysisIdRef = useRef<string | null>(null);
  const lastSummaryCountRef = useRef<number>(0);

  // Function to fetch latest data
  const fetchLatestData = useCallback(async () => {
    if (!conversationId) return;

    try {
      // Fetch latest intent analysis and summaries in parallel
      const [intentResponse, summariesResponse] = await Promise.all([
        ChatApiService.getLatestIntentAnalysis(conversationId),
        ChatApiService.getLatestSummaries(conversationId),
      ]);

      const newIntentAnalysis = intentResponse.data.intentAnalyses[0] || null;
      const newSummaries = summariesResponse.data.summaries || [];

      // Check if there's new data
      const hasNewIntentAnalysis = 
        newIntentAnalysis && 
        newIntentAnalysis.id !== lastIntentAnalysisIdRef.current;
      
      const hasNewSummaries = newSummaries.length !== lastSummaryCountRef.current;

      // Update state only if there's new data
      if (hasNewIntentAnalysis || hasNewSummaries) {
        setState(prev => ({
          ...prev,
          latestIntentAnalysis: newIntentAnalysis,
          latestSummaries: newSummaries,
          error: null,
        }));

        // Update refs to track latest data
        if (newIntentAnalysis) {
          lastIntentAnalysisIdRef.current = newIntentAnalysis.id;
        }
        lastSummaryCountRef.current = newSummaries.length;
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      }));
    }
  }, [conversationId]);

  // Function to start pinging
  const startPinging = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    setState(prev => ({ ...prev, isActive: true, error: null }));

    // Start immediate fetch
    fetchLatestData();

    // Set up interval for continuous pinging
    pingIntervalRef.current = setInterval(fetchLatestData, pingInterval);
  }, [fetchLatestData, pingInterval]);

  // Function to stop pinging
  const stopPinging = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    setState(prev => ({ ...prev, isActive: false }));
  }, []);

  // Function to handle user message (start pinging)
  const handleUserMessage = useCallback(() => {
    onUserMessage();
    startPinging();
  }, [onUserMessage, startPinging]);

  // Function to handle assistant message (stop pinging after delay)
  const handleAssistantMessage = useCallback(() => {
    onAssistantMessage();
    
    // Clear any existing stop timeout
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
    }

    // Set timeout to stop pinging after specified delay
    stopTimeoutRef.current = setTimeout(() => {
      stopPinging();
    }, stopDelayAfterAssistant);
  }, [onAssistantMessage, stopPinging, stopDelayAfterAssistant]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
      }
    };
  }, []);

  // Reset state when conversation changes
  useEffect(() => {
    setState({
      latestIntentAnalysis: null,
      latestSummaries: [],
      isActive: false,
      error: null,
    });
    lastIntentAnalysisIdRef.current = null;
    lastSummaryCountRef.current = 0;
    stopPinging();
  }, [conversationId, stopPinging]);

  return {
    ...state,
    handleUserMessage,
    handleAssistantMessage,
    startPinging,
    stopPinging,
    fetchLatestData,
  };
}