import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { RefreshCw, MessageSquare } from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Conversation, TokenData } from "../../types/chat";

interface TokenCounterProps {
  conversation?: Conversation | null;
  onRefresh?: () => void;
}

export function TokenCounter({ conversation, onRefresh }: TokenCounterProps) {
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const refreshTokenData = async () => {
    if (!conversation?.id) return;

    setIsRefreshing(true);
    setError(null);
    try {
      const response = await ChatApiService.getConversationTokens(conversation.id);
      if (response.success && response.data) {
        setTokenData(response.data);
      }
      onRefresh?.();
    } catch (error) {
      console.error("Failed to refresh token data:", error);
      setError("Failed to load token data");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (conversation?.id) {
      refreshTokenData();
    }
  }, [conversation?.id]);

  if (!conversation) {
    return null;
  }

  if (error) {
    return (
      <div className="flex gap-2 items-center text-xs text-red-500">
        <MessageSquare className="h-3 w-3" />
        <span>{error}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshTokenData}
          disabled={isRefreshing}
          className="p-0 w-5 h-5 opacity-60 hover:opacity-100"
        >
          <RefreshCw
            className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
    );
  }

  if (!tokenData) {
    return (
      <div className="flex gap-2 items-center text-xs text-muted-foreground">
        <MessageSquare className="h-3 w-3" />
        <span>Loading tokens...</span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-center text-xs text-muted-foreground">
      <div className="flex gap-1 items-center">
        <MessageSquare className="h-3 w-3" />
        <span className="font-mono">{formatTokens(tokenData.totalTokens)} tokens</span>
      </div>
      <div className="flex gap-2 items-center">
        <span>{tokenData.messageCount} messages</span>
        <span className="text-muted-foreground/60">
          (User: {formatTokens(tokenData.breakdown.userTokens)} | 
          Assistant: {formatTokens(tokenData.breakdown.assistantTokens)})
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={refreshTokenData}
        disabled={isRefreshing}
        className="p-0 w-5 h-5 opacity-60 hover:opacity-100"
      >
        <RefreshCw
          className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
        />
      </Button>
    </div>
  );
}
