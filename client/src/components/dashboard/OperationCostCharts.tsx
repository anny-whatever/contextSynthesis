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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { AnalyticsApiService } from "@/services/analyticsApi";

interface OperationBreakdownData {
  operationType: string;
  operationSubtype: string | null;
  displayName: string;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  operationCount: number;
}

interface TimelineData {
  date: string;
  total: number;
  [key: string]: number | string;
}

interface CumulativeData {
  messageCount: number;
  cumulativeCost: number;
  createdAt: string;
}

interface PerMessageTimelineData {
  messageCount: number;
  messageId: string;
  createdAt: string;
  [operationType: string]: number | string;
}

interface OperationCostChartsProps {
  timeframe: string;
  detailed?: boolean;
}

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#ec4899",
  "#6366f1",
];

export function OperationCostCharts({
  timeframe,
  detailed = false,
}: OperationCostChartsProps) {
  const [breakdown, setBreakdown] = useState<OperationBreakdownData[]>([]);
  const [timeline, setTimeline] = useState<TimelineData[]>([]);
  const [cumulativeData, setCumulativeData] = useState<CumulativeData[]>([]);
  const [perMessageTimeline, setPerMessageTimeline] = useState<PerMessageTimelineData[]>([]);
  const [perMessageOperationTypes, setPerMessageOperationTypes] = useState<string[]>([]);
  const [operationTypes, setOperationTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        if (detailed) {
          // For detailed view (Usage Trends), fetch per-message timeline data
          const [breakdownResponse, perMessageResponse] = await Promise.all([
            AnalyticsApiService.getOperationCostBreakdown(timeframe),
            AnalyticsApiService.getPerMessageOperationTimeline(timeframe),
          ]);
          setBreakdown(breakdownResponse.data.breakdown || []);
          setTimeline(breakdownResponse.data.timeline || []);
          setOperationTypes(breakdownResponse.data.operationTypes || []);
          setPerMessageTimeline(perMessageResponse.data.timeline || []);
          setPerMessageOperationTypes(perMessageResponse.data.operationTypes || []);
        } else {
          // For overview, fetch cumulative data
          const [breakdownResponse, cumulativeResponse] = await Promise.all([
            AnalyticsApiService.getOperationCostBreakdown(timeframe),
            AnalyticsApiService.getCumulativeCost(timeframe),
          ]);
          setBreakdown(breakdownResponse.data.breakdown || []);
          setTimeline(breakdownResponse.data.timeline || []);
          setOperationTypes(breakdownResponse.data.operationTypes || []);
          setCumulativeData(cumulativeResponse.data || []);
        }
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1">
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
            Error loading operation cost charts: {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Prepare pie chart data
  const pieData = breakdown.slice(0, 8).map((item, index) => ({
    name: item.displayName,
    value: item.totalCost,
    color: COLORS[index % COLORS.length],
    count: item.operationCount,
    tokens: item.totalTokens,
  }));

  // Custom tooltip for area chart
  const AreaTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{`Date: ${formatDate(label)}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {`${entry.dataKey}: ${formatCurrency(entry.value)}`}
            </p>
          ))}
          <p className="text-sm text-muted-foreground">
            {`Total: ${formatCurrency(
              payload.reduce((sum: number, entry: any) => sum + entry.value, 0)
            )}`}
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for pie chart
  const PieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{data.name}</p>
          <p>{`Cost: ${formatCurrency(data.value)}`}</p>
          <p>{`Operations: ${formatNumber(data.count)}`}</p>
          <p>{`Tokens: ${formatNumber(data.tokens)}`}</p>
        </div>
      );
    }
    return null;
  };

  const charts = [
    {
      title: "Operation Cost Breakdown",
      description: "Cost breakdown by operation type",
      component: (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={breakdown.slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="displayName"
              fontSize={12}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis tickFormatter={formatCurrency} fontSize={12} />
            <Tooltip
              formatter={(value: number) => [formatCurrency(value), "Total Cost"]}
              labelFormatter={(label) => `Operation: ${label}`}
            />
            <Bar
              dataKey="totalCost"
              fill="#3b82f6"
              name="Total Cost"
            />
          </BarChart>
        </ResponsiveContainer>
      ),
    },
    {
      title: detailed ? "Per-Message Operation Cost Timeline" : "Cumulative Cost Growth",
      description: detailed 
        ? "Cost breakdown by operation type per message" 
        : "Total spending growth over message count",
      component: detailed ? (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={perMessageTimeline}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="messageCount" 
              fontSize={12}
              label={{
                value: "Message Count",
                position: "insideBottom",
                offset: -5,
              }}
            />
            <YAxis 
              tickFormatter={formatCurrency} 
              fontSize={12}
              label={{
                value: "Cost per Message ($)",
                angle: -90,
                position: "insideLeft",
              }}
            />
            <Tooltip 
              formatter={(value: number, name: string) => [
                formatCurrency(value), 
                name
              ]}
              labelFormatter={(label) => `Message #${label}`}
            />
            <Legend />
            {perMessageOperationTypes.slice(0, 8).map((opType, index) => (
              <Line
                key={opType}
                type="monotone"
                dataKey={opType}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={{ fill: COLORS[index % COLORS.length], strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5, stroke: COLORS[index % COLORS.length], strokeWidth: 2 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={cumulativeData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="messageCount" 
              fontSize={12}
              label={{
                value: "Message Count",
                position: "insideBottom",
                offset: -5,
              }}
            />
            <YAxis 
              tickFormatter={formatCurrency} 
              fontSize={12}
              label={{
                value: "Cumulative Cost ($)",
                angle: -90,
                position: "insideLeft",
              }}
            />
            <Tooltip 
              formatter={(value: number) => [formatCurrency(value), "Cumulative Cost"]}
              labelFormatter={(label) => `Message #${label}`}
            />
            <Line
              type="monotone"
              dataKey="cumulativeCost"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ fill: "#10b981", strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: "#10b981", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ),
    },
    {
      title: "Operation Cost Distribution",
      description: "Percentage breakdown of costs by operation type",
      component: (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
              label={({ name, percent }) =>
                `${name} ${(percent * 100).toFixed(1)}%`
              }
              labelLine={false}
            >
              {pieData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      ),
    },
    {
      title: "Operation Volume vs Cost",
      description: "Comparison of operation count and total cost",
      component: (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={breakdown.slice(0, 8)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="displayName"
              fontSize={12}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              yAxisId="cost"
              orientation="left"
              tickFormatter={formatCurrency}
              fontSize={12}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              tickFormatter={formatNumber}
              fontSize={12}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                name === "totalCost"
                  ? formatCurrency(value)
                  : formatNumber(value),
                name === "totalCost" ? "Total Cost" : "Operation Count",
              ]}
            />
            <Legend />
            <Bar
              yAxisId="cost"
              dataKey="totalCost"
              fill="#10b981"
              name="Total Cost"
            />
            <Bar
              yAxisId="count"
              dataKey="operationCount"
              fill="#3b82f6"
              name="Operation Count"
            />
          </BarChart>
        </ResponsiveContainer>
      ),
    },
  ];

  const chartsToShow = detailed ? charts : [charts[0], charts[1]];

  return (
    <div className="grid gap-4 grid-cols-1">
      {chartsToShow.map((chart, index) => (
        <Card key={index}>
          <CardHeader>
            <CardTitle>{chart.title}</CardTitle>
            <CardDescription>{chart.description}</CardDescription>
          </CardHeader>
          <CardContent>{chart.component}</CardContent>
        </Card>
      ))}

      {/* Summary table */}
      <Card>
        <CardHeader>
          <CardTitle>Operation Cost Summary</CardTitle>
          <CardDescription>
            Detailed breakdown by operation type and subtype
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Operation</th>
                  <th className="text-right p-2">Count</th>
                  <th className="text-right p-2">Total Cost</th>
                  <th className="text-right p-2">Avg Cost</th>
                  <th className="text-right p-2">Total Tokens</th>
                  <th className="text-right p-2">Avg Tokens</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.slice(0, 10).map((item, index) => (
                  <tr key={index} className="border-b hover:bg-muted/50">
                    <td className="p-2 font-medium">{item.displayName}</td>
                    <td className="p-2 text-right">
                      {formatNumber(item.operationCount)}
                    </td>
                    <td className="p-2 text-right">
                      {formatCurrency(item.totalCost)}
                    </td>
                    <td className="p-2 text-right">
                      {formatCurrency(
                        item.operationCount > 0
                          ? item.totalCost / item.operationCount
                          : 0
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {formatNumber(item.totalTokens)}
                    </td>
                    <td className="p-2 text-right">
                      {formatNumber(
                        item.operationCount > 0
                          ? item.totalTokens / item.operationCount
                          : 0
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
