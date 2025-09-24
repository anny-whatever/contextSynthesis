import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { RefreshCw, DollarSign } from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Conversation } from "../../types/chat";

interface CostCounterProps {
  conversation?: Conversation | null;
  onRefresh?: () => void;
}

interface CostData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalTokens: number;
}

export function CostCounter({ conversation, onRefresh }: CostCounterProps) {
  const [costData, setCostData] = useState<CostData>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalTokens: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const formatCost = (cost: number): string => {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const refreshCostData = async () => {
    if (!conversation?.id) return;

    setIsRefreshing(true);
    try {
      const response = await ChatApiService.getConversation(conversation.id);
      if (response.success && response.data) {
        const conv = response.data;
        setCostData({
          totalInputTokens: conv.totalInputTokens || 0,
          totalOutputTokens: conv.totalOutputTokens || 0,
          totalCost: conv.totalCost || 0,
          totalTokens:
            (conv.totalInputTokens || 0) + (conv.totalOutputTokens || 0),
        });
      }
      onRefresh?.();
    } catch (error) {
      console.error("Failed to refresh cost data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (conversation) {
      setCostData({
        totalInputTokens: conversation.totalInputTokens || 0,
        totalOutputTokens: conversation.totalOutputTokens || 0,
        totalCost: conversation.totalCost || 0,
        totalTokens:
          (conversation.totalInputTokens || 0) +
          (conversation.totalOutputTokens || 0),
      });
    }
  }, [conversation]);

  if (!conversation) {
    return null;
  }

  return (
    <div className="flex gap-3 items-center text-xs text-muted-foreground">
      <div className="flex gap-1 items-center">
        <span className="font-mono">{formatCost(costData.totalCost)}</span>
      </div>
      <div className="flex gap-2 items-center">
        <span>Tokens: {formatTokens(costData.totalTokens)}</span>
        <span className="text-muted-foreground/60">
          ({formatTokens(costData.totalInputTokens)}↑{" "}
          {formatTokens(costData.totalOutputTokens)}↓)
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={refreshCostData}
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
