import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
} from "recharts";
import { AnalyticsApiService } from "@/services/analyticsApi";

interface MessageUsageData {
  messageId: string;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  operationCount: number;
  totalDuration: number;
  lastActivity: string;
  messageContent: string;
  messageRole: string;
  conversationTitle: string;
  conversationId: string;
  createdAt: string;
}

interface UsageChartsProps {
  timeframe: string;
  detailed?: boolean;
}

export function UsageCharts({ timeframe, detailed = false }: UsageChartsProps) {
  const [data, setData] = useState<MessageUsageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await AnalyticsApiService.getPerMessageUsage(
          timeframe,
          detailed ? 100 : 50
        );
        setData(response.data.messages || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [timeframe, detailed]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("en-US").format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{`Message: ${data.messageContent}`}</p>
          <p className="text-sm text-muted-foreground">{`Role: ${data.messageRole}`}</p>
          <p className="text-sm text-muted-foreground">{`Conversation: ${
            data.conversationTitle || "Untitled"
          }`}</p>
          <p className="text-sm">{`Cost: ${formatCurrency(data.totalCost)}`}</p>
          <p className="text-sm">{`Tokens: ${formatNumber(
            data.totalTokens
          )}`}</p>
          <p className="text-sm">{`Operations: ${data.operationCount}`}</p>
          <p className="text-sm text-muted-foreground">{`Created: ${formatDate(
            data.createdAt
          )}`}</p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className={`grid gap-4 ${detailed ? "grid-cols-1" : "grid-cols-1"}`}>
        <Card>
          <CardHeader>
            <Skeleton className="w-32 h-6" />
            <Skeleton className="w-48 h-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="w-full h-64" />
          </CardContent>
        </Card>
        {detailed && (
          <>
            <Card>
              <CardHeader>
                <Skeleton className="w-32 h-6" />
                <Skeleton className="w-48 h-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="w-full h-64" />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            Error loading usage charts: {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Prepare data for charts - sort by creation time for line chart
  const sortedData = [...data].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Add index for x-axis
  const chartData = sortedData.map((item, index) => ({
    ...item,
    messageIndex: index + 1,
    shortContent:
      item.messageContent.length > 30
        ? item.messageContent.substring(0, 30) + "..."
        : item.messageContent,
  }));

  const charts = [
    {
      title: "Cost per Message",
      description: "Total cost for each message's operations",
      dataKey: "totalCost",
      color: "#10b981",
      formatter: formatCurrency,
      type: "line" as const,
    },
    {
      title: "Token Usage per Message",
      description: "Total tokens consumed per message",
      dataKey: "totalTokens",
      color: "#8b5cf6",
      formatter: formatNumber,
      type: "line" as const,
    },
    {
      title: "Cost vs Token Usage",
      description: "Cost progression with area tracing per message",
      dataKey: "totalCost",
      color: "#3b82f6",
      formatter: formatCurrency,
      type: "area" as const,
    },
  ];

  const chartsToShow = detailed ? charts : [charts[0], charts[1]];

  return (
    <div className={`grid gap-4 ${detailed ? "grid-cols-1" : "grid-cols-1"}`}>
      {chartsToShow.map((chart, index) => (
        <Card key={index}>
          <CardHeader>
            <CardTitle>{chart.title}</CardTitle>
            <CardDescription>{chart.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              {chart.type === "area" ? (
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="messageIndex"
                    fontSize={12}
                    label={{
                      value: "Message Sequence",
                      position: "insideBottom",
                      offset: -5,
                    }}
                  />
                  <YAxis
                    tickFormatter={formatCurrency}
                    fontSize={12}
                    label={{
                      value: "Cost ($)",
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey={chart.dataKey}
                    stroke={chart.color}
                    fill={chart.color}
                    fillOpacity={0.3}
                    strokeWidth={2}
                    dot={{ fill: chart.color, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: chart.color, strokeWidth: 2 }}
                  />
                </AreaChart>
              ) : (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="messageIndex"
                    fontSize={12}
                    label={{
                      value: "Message Sequence",
                      position: "insideBottom",
                      offset: -5,
                    }}
                  />
                  <YAxis
                    tickFormatter={chart.formatter}
                    fontSize={12}
                    label={{
                      value:
                        chart.dataKey === "totalCost" ? "Cost ($)" : "Tokens",
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey={chart.dataKey}
                    stroke={chart.color}
                    strokeWidth={2}
                    dot={{ fill: chart.color, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: chart.color, strokeWidth: 2 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ))}

      {/* Summary stats */}
      <Card>
        <CardHeader>
          <CardTitle>Message Usage Summary</CardTitle>
          <CardDescription>
            Aggregate statistics for the selected timeframe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {data.length}
              </div>
              <div className="text-sm text-muted-foreground">
                Total Messages
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(
                  data.reduce((sum, item) => sum + item.totalCost, 0)
                )}
              </div>
              <div className="text-sm text-muted-foreground">Total Cost</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {formatNumber(
                  data.reduce((sum, item) => sum + item.totalTokens, 0)
                )}
              </div>
              <div className="text-sm text-muted-foreground">Total Tokens</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {formatCurrency(
                  data.length > 0
                    ? data.reduce((sum, item) => sum + item.totalCost, 0) /
                        data.length
                    : 0
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                Avg Cost/Message
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
