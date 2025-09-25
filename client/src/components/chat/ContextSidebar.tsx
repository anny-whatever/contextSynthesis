import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Alert, AlertDescription } from "../ui/alert";
import { AlertCircle, Brain, FileText, Clock, Target } from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Summary, IntentAnalysis } from "../../types/chat";

interface ContextSidebarProps {
  conversationId: string | null;
}

export function ContextSidebar({ conversationId }: ContextSidebarProps) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [intentAnalyses, setIntentAnalyses] = useState<IntentAnalysis[]>([]);
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);
  const [isLoadingIntents, setIsLoadingIntents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (conversationId) {
      loadSummaries();
      loadIntentAnalyses();
    } else {
      setSummaries([]);
      setIntentAnalyses([]);
    }
  }, [conversationId]);

  const loadSummaries = async () => {
    if (!conversationId) return;

    try {
      setIsLoadingSummaries(true);
      setError(null);
      const response = await ChatApiService.getConversationSummaries(
        conversationId
      );
      setSummaries(response.data.summaries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load summaries");
    } finally {
      setIsLoadingSummaries(false);
    }
  };

  const loadIntentAnalyses = async () => {
    if (!conversationId) return;

    try {
      setIsLoadingIntents(true);
      setError(null);
      const response = await ChatApiService.getConversationIntentAnalyses(
        conversationId
      );
      setIntentAnalyses(response.data.intentAnalyses);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load intent analyses"
      );
    } finally {
      setIsLoadingIntents(false);
    }
  };

  const getSummaryTypeColor = (type: string) => {
    switch (type) {
      case "CONVERSATION":
        return "bg-blue-100 text-blue-800";
      case "TOPIC":
        return "bg-green-100 text-green-800";
      case "DECISION":
        return "bg-purple-100 text-purple-800";
      case "ACTION_ITEMS":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  if (!conversationId) {
    return (
      <Card className="w-80 h-full">
        <CardHeader>
          <CardTitle className="flex gap-2 items-center">
            <Brain className="w-5 h-5" />
            Context Engineering
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-muted-foreground">
            <p>Select a conversation to view context analysis</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-[25vw] h-full rounded-none">
      <CardHeader>
        <CardTitle className="flex gap-2 items-center">
          <Brain className="w-5 h-5" />
          Context Engineering
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="intent" className="h-full">
          <TabsList className="grid grid-cols-2 mx-2">
            <TabsTrigger value="intent" className="flex gap-2 items-center">
              <Target className="w-4 h-4" />
              Intent Analysis
            </TabsTrigger>
            <TabsTrigger value="summaries" className="flex gap-2 items-center">
              <FileText className="w-4 h-4" />
              Summaries
            </TabsTrigger>
          </TabsList>

          <TabsContent value="intent" className="mt-0">
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="p-4 space-y-4">
                {isLoadingIntents ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <Card key={i}>
                        <CardContent className="p-4">
                          <Skeleton className="mb-2 w-full h-4" />
                          <Skeleton className="mb-2 w-3/4 h-4" />
                          <Skeleton className="w-1/2 h-4" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : intentAnalyses.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <p>No intent analyses found</p>
                  </div>
                ) : (
                  intentAnalyses.map((analysis) => {
                    const result = analysis.analysisResult || {};
                    return (
                      <Card
                        key={analysis.id}
                        className="border-l-4 border-l-blue-500"
                      >
                        <CardContent className="p-3">
                          <div className="space-y-2">
                            {/* Current Intent */}
                            <div>
                              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                                Intent
                              </h4>
                              <p className="text-sm leading-tight">
                                {result.currentIntent || analysis.currentIntent}
                              </p>
                            </div>

                            {/* Key Topics */}
                            {(result.keyTopics || analysis.keyTopics)?.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                                  Topics
                                </h4>
                                <div className="flex flex-wrap gap-1">
                                  {(result.keyTopics || analysis.keyTopics).map((topic: string, index: number) => (
                                    <Badge
                                      key={index}
                                      variant="secondary"
                                      className="text-xs px-2 py-0.5 h-auto"
                                    >
                                      {topic}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Contextual Relevance */}
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-medium text-muted-foreground">
                                Relevance
                              </h4>
                              <Badge 
                                variant="outline" 
                                className={`text-xs px-2 py-0.5 h-auto ${
                                  result.contextualRelevance === 'high' 
                                    ? 'bg-green-50 text-green-700 border-green-200' 
                                    : result.contextualRelevance === 'medium'
                                    ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                    : result.contextualRelevance === 'low'
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : ''
                                }`}
                              >
                                {result.contextualRelevance || 
                                 (typeof analysis.contextualRelevance === 'number' 
                                   ? `${(analysis.contextualRelevance * 100).toFixed(0)}%`
                                   : 'N/A')}
                              </Badge>
                            </div>

                            {/* Relationship to History */}
                            {result.relationshipToHistory && (
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-medium text-muted-foreground">
                                  Relationship
                                </h4>
                                <Badge variant="outline" className="text-xs px-2 py-0.5 h-auto">
                                  {result.relationshipToHistory}
                                </Badge>
                              </div>
                            )}

                            {/* Pending Questions */}
                            {(result.pendingQuestions || analysis.pendingQuestions)?.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                                  Pending Questions
                                </h4>
                                <ul className="space-y-0.5 text-xs text-muted-foreground">
                                  {(result.pendingQuestions || analysis.pendingQuestions).map(
                                    (question: string, index: number) => (
                                      <li key={index} className="leading-tight">• {question}</li>
                                    )
                                  )}
                                </ul>
                              </div>
                            )}

                            {/* Last Assistant Question */}
                            {result.lastAssistantQuestion && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                                  Last Question
                                </h4>
                                <p className="text-xs text-muted-foreground leading-tight">
                                  {result.lastAssistantQuestion}
                                </p>
                              </div>
                            )}

                            {/* Compressed Context */}
                            {result.compressedContext && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                                  Context
                                </h4>
                                <p className="text-xs text-muted-foreground leading-tight">
                                  {result.compressedContext}
                                </p>
                              </div>
                            )}

                            {/* Timestamp */}
                            <div className="flex gap-1 items-center pt-1 text-xs border-t text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatDate(analysis.createdAt)}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="summaries" className="mt-0">
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="p-4 space-y-4">
                {isLoadingSummaries ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <Card key={i}>
                        <CardContent className="p-4">
                          <Skeleton className="mb-2 w-full h-4" />
                          <Skeleton className="mb-2 w-3/4 h-4" />
                          <Skeleton className="w-1/2 h-4" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : summaries.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <p>No summaries found</p>
                  </div>
                ) : (
                  summaries.map((summary) => (
                    <Card
                      key={summary.id}
                      className="border-l-4 border-l-green-500"
                    >
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <Badge
                              className={getSummaryTypeColor(
                                summary.summaryType
                              )}
                            >
                              {summary.summaryType.replace("_", " ")}
                            </Badge>
                          </div>

                          <div>
                            <h4 className="mb-2 text-sm font-semibold">
                              Summary
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {summary.content}
                            </p>
                          </div>

                          {summary.keyPoints.length > 0 && (
                            <div>
                              <h4 className="mb-2 text-sm font-semibold">
                                Key Points
                              </h4>
                              <ul className="space-y-1 text-xs text-muted-foreground">
                                {summary.keyPoints.map((point, index) => (
                                  <li key={index}>• {point}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="flex gap-2 items-center pt-2 text-xs border-t text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {formatDate(summary.createdAt)}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
