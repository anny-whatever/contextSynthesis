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
  AreaChart,
  Area,
} from "recharts";

interface TimelineData {
  date: string;
  usageCount: number;
  totalCost: number;
  totalTokens: number;
  avgDuration: number;
}

interface UsageChartsProps {
  timeframe: string;
  detailed?: boolean;
}

export function UsageCharts({ timeframe, detailed = false }: UsageChartsProps) {
  const [data, setData] = useState<TimelineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTimelineData = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/analytics/usage-timeline?timeframe=${timeframe}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch timeline data");
        }
        const result = await response.json();
        setData(result.data.timeline || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchTimelineData();
  }, [timeframe]);

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
    const date = new Date(dateStr);
    if (timeframe === "24h") {
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  const charts = [
    {
      title: "Usage Count Over Time",
      description: "Number of API calls per period",
      dataKey: "usageCount",
      color: "#3b82f6",
      formatter: formatNumber,
    },
    {
      title: "Cost Over Time",
      description: "Total cost per period",
      dataKey: "totalCost",
      color: "#10b981",
      formatter: formatCurrency,
    },
    {
      title: "Token Usage Over Time",
      description: "Total tokens consumed per period",
      dataKey: "totalTokens",
      color: "#8b5cf6",
      formatter: formatNumber,
    },
  ];

  const chartsToShow = detailed ? charts : [charts[0]];

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
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  fontSize={12}
                />
                <YAxis tickFormatter={chart.formatter} fontSize={12} />
                <Tooltip
                  labelFormatter={(label) => formatDate(label)}
                  formatter={(value: number) => [
                    chart.formatter(value),
                    chart.title.split(" ")[0],
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey={chart.dataKey}
                  stroke={chart.color}
                  fill={chart.color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
