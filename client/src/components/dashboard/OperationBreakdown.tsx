import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

interface OperationData {
  operationType: string;
  count: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDuration: number;
  avgDuration: number;
}

interface OperationBreakdownProps {
  timeframe: string;
  detailed?: boolean;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const OPERATION_LABELS: Record<string, string> = {
  AGENT_COMPLETION: 'Agent Completion',
  INTENT_ANALYSIS: 'Intent Analysis',
  SUMMARIZATION: 'Summarization',
  TOPIC_EXTRACTION: 'Topic Extraction',
  TOOL_CALL: 'Tool Call',
  EMBEDDING_GENERATION: 'Embedding Generation',
};

export function OperationBreakdown({ timeframe, detailed = false }: OperationBreakdownProps) {
  const [data, setData] = useState<OperationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOperationData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/analytics/usage-by-operation?timeframe=${timeframe}`);
        if (!response.ok) {
          throw new Error('Failed to fetch operation data');
        }
        const result = await response.json();
        setData(result.data.usageByOperation || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchOperationData();
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

  const getOperationLabel = (type: string) => {
    return OPERATION_LABELS[type] || type;
  };

  if (loading) {
    return (
      <div className={`grid gap-4 ${detailed ? 'grid-cols-1' : 'grid-cols-1'}`}>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        {detailed && (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            Error loading operation breakdown: {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  const pieData = data.map((item, index) => ({
    name: getOperationLabel(item.operationType),
    value: item.count,
    cost: item.totalCost,
    color: COLORS[index % COLORS.length],
  }));

  const barData = data.map((item) => ({
    name: getOperationLabel(item.operationType),
    cost: item.totalCost,
    tokens: item.totalTokens,
    avgDuration: item.avgDuration,
  }));

  return (
    <div className={`grid gap-4 ${detailed ? 'grid-cols-1' : 'grid-cols-1'}`}>
      {/* Pie Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Operations by Count</CardTitle>
          <CardDescription>Distribution of API calls by operation type</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [formatNumber(value), 'Count']} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Bar Chart (detailed view) */}
      {detailed && (
        <Card>
          <CardHeader>
            <CardTitle>Cost by Operation Type</CardTitle>
            <CardDescription>Total cost breakdown by operation</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  fontSize={12}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  tickFormatter={formatCurrency}
                  fontSize={12}
                />
                <Tooltip 
                  formatter={(value: number) => [formatCurrency(value), 'Cost']}
                />
                <Bar dataKey="cost" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Detailed Table */}
      {detailed && (
        <Card>
          <CardHeader>
            <CardTitle>Operation Details</CardTitle>
            <CardDescription>Detailed breakdown of all operations</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation Type</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Total Tokens</TableHead>
                  <TableHead className="text-right">Avg Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item, index) => (
                  <TableRow key={item.operationType}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="font-medium">
                          {getOperationLabel(item.operationType)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">
                        {formatNumber(item.count)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(item.totalCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(item.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDuration(item.avgDuration)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}