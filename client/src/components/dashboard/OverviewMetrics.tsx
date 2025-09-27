import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, MessageSquare, Users, Clock, Zap, TrendingUp } from "lucide-react";
import { AnalyticsApiService } from "@/services/analyticsApi";

interface OverviewData {
  totalUsages: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalMessages: number;
  totalConversations: number;
  avgResponseTime: number;
}

interface OverviewMetricsProps {
  timeframe: string;
}

export function OverviewMetrics({ timeframe }: OverviewMetricsProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverviewData = async () => {
      try {
        setLoading(true);
        const result = await AnalyticsApiService.getOverview(timeframe);
        setData(result.data.overview);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchOverviewData();
  }, [timeframe]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getTimeframeLabel = (tf: string) => {
    switch (tf) {
      case '24h': return 'Last 24 hours';
      case '7d': return 'Last 7 days';
      case '30d': return 'Last 30 days';
      case '90d': return 'Last 90 days';
      default: return 'Last 7 days';
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            Error loading overview data: {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const metrics = [
    {
      title: "Total Cost",
      value: formatCurrency(data.totalCost),
      description: getTimeframeLabel(timeframe),
      icon: DollarSign,
      color: "text-green-600",
    },
    {
      title: "API Calls",
      value: formatNumber(data.totalUsages),
      description: "Total operations",
      icon: Zap,
      color: "text-blue-600",
    },
    {
      title: "Total Tokens",
      value: formatNumber(data.totalTokens),
      description: `${formatNumber(data.inputTokens)} in / ${formatNumber(data.outputTokens)} out`,
      icon: TrendingUp,
      color: "text-purple-600",
    },
    {
      title: "Messages",
      value: formatNumber(data.totalMessages),
      description: "User & assistant messages",
      icon: MessageSquare,
      color: "text-orange-600",
    },
    {
      title: "Conversations",
      value: formatNumber(data.totalConversations),
      description: "Active conversations",
      icon: Users,
      color: "text-indigo-600",
    },
    {
      title: "Avg Response Time",
      value: formatDuration(data.avgResponseTime),
      description: "Average processing time",
      icon: Clock,
      color: "text-teal-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <Icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}