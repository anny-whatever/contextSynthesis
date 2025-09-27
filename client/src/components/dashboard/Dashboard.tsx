import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BarChart3, Users, DollarSign, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { OverviewMetrics } from "./OverviewMetrics";
import { UsageCharts } from "./UsageCharts";
import { OperationBreakdown } from "./OperationBreakdown";
import { TopUsers } from "./TopUsers";
import { ErrorAnalysis } from "./ErrorAnalysis";

export function Dashboard() {
  const [timeframe, setTimeframe] = useState("7d");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Chat
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
                <p className="text-muted-foreground">Monitor usage, costs, and performance metrics</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="usage" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Usage Trends
            </TabsTrigger>
            <TabsTrigger value="operations" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Operations
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Top Users
            </TabsTrigger>
            <TabsTrigger value="errors" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Error Analysis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewMetrics timeframe={timeframe} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <UsageCharts timeframe={timeframe} />
              <OperationBreakdown timeframe={timeframe} />
            </div>
          </TabsContent>

          <TabsContent value="usage" className="space-y-6">
            <UsageCharts timeframe={timeframe} detailed />
          </TabsContent>

          <TabsContent value="operations" className="space-y-6">
            <OperationBreakdown timeframe={timeframe} detailed />
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <TopUsers timeframe={timeframe} />
          </TabsContent>

          <TabsContent value="errors" className="space-y-6">
            <ErrorAnalysis timeframe={timeframe} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}