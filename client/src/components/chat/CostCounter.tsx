import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { RefreshCw, DollarSign, Zap } from "lucide-react";
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
          totalTokens: (conv.totalInputTokens || 0) + (conv.totalOutputTokens || 0),
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
        totalTokens: (conversation.totalInputTokens || 0) + (conversation.totalOutputTokens || 0),
      });
    }
  }, [conversation]);

  if (!conversation) {
    return null;
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">Usage & Cost</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshCostData}
            disabled={isRefreshing}
            className="h-6 w-6 p-0"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total Cost:</span>
              <Badge variant="secondary" className="text-xs font-mono">
                {formatCost(costData.totalCost)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total Tokens:</span>
              <Badge variant="outline" className="text-xs font-mono">
                <Zap className="h-3 w-3 mr-1" />
                {formatTokens(costData.totalTokens)}
              </Badge>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Input:</span>
              <Badge variant="outline" className="text-xs font-mono">
                {formatTokens(costData.totalInputTokens)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Output:</span>
              <Badge variant="outline" className="text-xs font-mono">
                {formatTokens(costData.totalOutputTokens)}
              </Badge>
            </div>
          </div>
        </div>

        {costData.totalCost > 0 && (
          <div className="mt-2 pt-2 border-t">
            <div className="text-xs text-muted-foreground text-center">
              Model: GPT-4o-mini • Input: $0.15/1M • Output: $0.60/1M
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}