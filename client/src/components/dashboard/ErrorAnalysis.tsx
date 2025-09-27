import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { AlertTriangle, CheckCircle, XCircle, TrendingUp, TrendingDown } from "lucide-react";

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
  AGENT_COMPLETION: 'Agent Completion',
  INTENT_ANALYSIS: 'Intent Analysis',
  SUMMARIZATION: 'Summarization',
  TOPIC_EXTRACTION: 'Topic Extraction',
  TOOL_CALL: 'Tool Call',
  EMBEDDING_GENERATION: 'Embedding Generation',
};

export function ErrorAnalysis({ timeframe }: ErrorAnalysisProps) {
  const [data, setData] = useState<ErrorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchErrorData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/analytics/error-rates?timeframe=${timeframe}`);
        if (!response.ok) {
          throw new Error('Failed to fetch error data');
        }
        const result = await response.json();
        setData(result.data.errorRates || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
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
    return new Intl.NumberFormat('en-US').format(num);
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
    if (errorRate === 0) return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (errorRate < 0.05) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getTrendIcon = (errorRate: number) => {
    // This is a simplified trend indicator - in a real app you'd compare with previous periods
    if (errorRate === 0) return <TrendingDown className="h-3 w-3 text-green-500" />;
    if (errorRate < 0.05) return <TrendingUp className="h-3 w-3 text-yellow-500" />;
    return <TrendingUp className="h-3 w-3 text-red-500" />;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
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
            <AlertTriangle className="h-4 w-4" />
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Overall Error Rate</p>
                <p className="text-2xl font-bold">{formatPercentage(overallErrorRate)}</p>
              </div>
              {getErrorIcon(overallErrorRate)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Requests</p>
                <p className="text-2xl font-bold">{formatNumber(totalRequests)}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Errors</p>
                <p className="text-2xl font-bold">{formatNumber(totalErrors)}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Error Rates by Operation</CardTitle>
          <CardDescription>Error percentage for each operation type</CardDescription>
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
              <YAxis 
                tickFormatter={(value) => `${value}%`}
                fontSize={12}
              />
              <Tooltip 
                formatter={(value: number, name: string) => [
                  `${value.toFixed(2)}%`, 
                  name === 'errorRate' ? 'Error Rate' : 'Success Rate'
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
          <CardDescription>Detailed breakdown of errors by operation type</CardDescription>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
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
                      <span className="text-green-600 font-medium">
                        {formatNumber(item.successCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-red-600 font-medium">
                        {formatNumber(item.errorCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Badge variant={getErrorBadgeVariant(item.errorRate)}>
                          {formatPercentage(item.errorRate)}
                        </Badge>
                        {getTrendIcon(item.errorRate)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end">
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
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            High error rate detected ({formatPercentage(overallErrorRate)}). 
            Consider investigating the most problematic operations.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}