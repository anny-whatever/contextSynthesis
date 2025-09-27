import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { AnalyticsApiService } from "@/services/analyticsApi";

interface ErrorData {
  operationType: string;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  successCount: number;
  successRate: number;
}

interface ErrorAnalysisProps {
  timeframe: string;
}

const OPERATION_LABELS: Record<string, string> = {
  AGENT_COMPLETION: "Agent Completion",
  INTENT_ANALYSIS: "Intent Analysis",
  SUMMARIZATION: "Summarization",
  TOPIC_EXTRACTION: "Topic Extraction",
  TOOL_CALL: "Tool Call",
  EMBEDDING_GENERATION: "Embedding Generation",
};

export function ErrorAnalysis({ timeframe }: ErrorAnalysisProps) {
  const [data, setData] = useState<ErrorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchErrorData = async () => {
      try {
        setLoading(true);
        const result = await AnalyticsApiService.getErrorRates(timeframe);
        setData(result.data.errorRates || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchErrorData();
  }, [timeframe]);

  const formatPercentage = (rate: number) => {
    return `${(rate * 100).toFixed(2)}%`;
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  const getOperationLabel = (type: string) => {
    return OPERATION_LABELS[type] || type;
  };

  const getErrorBadgeVariant = (errorRate: number) => {
    if (errorRate === 0) return "default";
    if (errorRate < 0.05) return "secondary"; // < 5%
    if (errorRate < 0.1) return "outline"; // < 10%
    return "destructive"; // >= 10%
  };

  const getErrorIcon = (errorRate: number) => {
    if (errorRate === 0)
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (errorRate < 0.05)
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  const getTrendIcon = (errorRate: number) => {
    // This is a simplified trend indicator - in a real app you'd compare with previous periods
    if (errorRate === 0)
      return <TrendingDown className="w-3 h-3 text-green-500" />;
    if (errorRate < 0.05)
      return <TrendingUp className="w-3 h-3 text-yellow-500" />;
    return <TrendingUp className="w-3 h-3 text-red-500" />;
  };

  if (loading) {
    return (
      <div className="space-y-4">
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
            <Skeleton className="w-full h-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              Error loading error analysis: {error}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const totalRequests = data.reduce((sum, item) => sum + item.totalRequests, 0);
  const totalErrors = data.reduce((sum, item) => sum + item.errorCount, 0);
  const overallErrorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

  const chartData = data.map((item) => ({
    name: getOperationLabel(item.operationType),
    errorRate: item.errorRate * 100,
    successRate: item.successRate * 100,
    totalRequests: item.totalRequests,
  }));

  return (
    <div className="space-y-4">
      {/* Overall Error Rate Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Overall Error Rate
                </p>
                <p className="text-2xl font-bold">
                  {formatPercentage(overallErrorRate)}
                </p>
              </div>
              {getErrorIcon(overallErrorRate)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Requests
                </p>
                <p className="text-2xl font-bold">
                  {formatNumber(totalRequests)}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Errors
                </p>
                <p className="text-2xl font-bold">
                  {formatNumber(totalErrors)}
                </p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Error Rates by Operation</CardTitle>
          <CardDescription>
            Error percentage for each operation type
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                fontSize={12}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis tickFormatter={(value) => `${value}%`} fontSize={12} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value.toFixed(2)}%`,
                  name === "errorRate" ? "Error Rate" : "Success Rate",
                ]}
              />
              <Bar dataKey="errorRate" fill="#ef4444" name="Error Rate" />
              <Bar dataKey="successRate" fill="#10b981" name="Success Rate" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Error Table */}
      <Card>
        <CardHeader>
          <CardTitle>Error Analysis Details</CardTitle>
          <CardDescription>
            Detailed breakdown of errors by operation type
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No error data available for the selected timeframe
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation Type</TableHead>
                  <TableHead className="text-right">Total Requests</TableHead>
                  <TableHead className="text-right">Successful</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Error Rate</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => (
                  <TableRow key={item.operationType}>
                    <TableCell className="font-medium">
                      {getOperationLabel(item.operationType)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(item.totalRequests)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium text-green-600">
                        {formatNumber(item.successCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium text-red-600">
                        {formatNumber(item.errorCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end items-center">
                        <Badge variant={getErrorBadgeVariant(item.errorRate)}>
                          {formatPercentage(item.errorRate)}
                        </Badge>
                        {getTrendIcon(item.errorRate)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center">
                        {getErrorIcon(item.errorRate)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Health Status Alert */}
      {overallErrorRate > 0.1 && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            High error rate detected ({formatPercentage(overallErrorRate)}).
            Consider investigating the most problematic operations.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
