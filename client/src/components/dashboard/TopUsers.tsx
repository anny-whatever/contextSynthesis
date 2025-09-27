import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Trophy, Medal, Award, User } from "lucide-react";

interface UserData {
  userId: string;
  user: {
    id: string;
    email: string;
    name?: string;
  };
  totalUsage: number;
  totalCost: number;
  totalTokens: number;
  messageCount: number;
  conversationCount: number;
  avgResponseTime: number;
}

interface TopUsersProps {
  timeframe: string;
  limit?: number;
}

export function TopUsers({ timeframe, limit = 10 }: TopUsersProps) {
  const [data, setData] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTopUsers = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/analytics/top-users?timeframe=${timeframe}&limit=${limit}`);
        if (!response.ok) {
          throw new Error('Failed to fetch top users data');
        }
        const result = await response.json();
        setData(result.data.topUsers || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchTopUsers();
  }, [timeframe, limit]);

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

  const getUserInitials = (user: UserData['user']) => {
    if (user.name) {
      return user.name.split(' ').map(n => n[0]).join('').toUpperCase();
    }
    return user.email.substring(0, 2).toUpperCase();
  };

  const getUserDisplayName = (user: UserData['user']) => {
    return user.name || user.email;
  };

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0:
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 1:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 2:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return <User className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getRankBadgeVariant = (index: number) => {
    switch (index) {
      case 0:
        return "default" as const;
      case 1:
        return "secondary" as const;
      case 2:
        return "outline" as const;
      default:
        return "outline" as const;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            Error loading top users: {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxUsage = data.length > 0 ? data[0].totalUsage : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Top Users
        </CardTitle>
        <CardDescription>Most active users by total usage</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No user data available for the selected timeframe
          </div>
        ) : (
          <div className="space-y-4">
            {/* Top 3 Users - Special Display */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {data.slice(0, 3).map((user, index) => (
                <Card key={user.userId} className="relative">
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center text-center space-y-2">
                      <div className="absolute top-2 right-2">
                        {getRankIcon(index)}
                      </div>
                      <Avatar className="h-12 w-12">
                        <AvatarFallback>
                          {getUserInitials(user.user)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">
                          {getUserDisplayName(user.user)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Rank #{index + 1}
                        </p>
                      </div>
                      <div className="space-y-1 w-full">
                        <div className="flex justify-between text-xs">
                          <span>Usage</span>
                          <span className="font-mono">{formatNumber(user.totalUsage)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span>Cost</span>
                          <span className="font-mono">{formatCurrency(user.totalCost)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Detailed Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Usage</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Avg Response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((user, index) => (
                  <TableRow key={user.userId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getRankIcon(index)}
                        <Badge variant={getRankBadgeVariant(index)}>
                          #{index + 1}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {getUserInitials(user.user)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">
                            {getUserDisplayName(user.user)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {user.conversationCount} conversations
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-1">
                        <div className="font-mono text-sm">
                          {formatNumber(user.totalUsage)}
                        </div>
                        <Progress 
                          value={(user.totalUsage / maxUsage) * 100} 
                          className="h-1 w-16 ml-auto"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCurrency(user.totalCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(user.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(user.messageCount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDuration(user.avgResponseTime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}