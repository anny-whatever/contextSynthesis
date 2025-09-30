import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Alert, AlertDescription } from "../ui/alert";
import {
  AlertCircle,
  Brain,
  FileText,
  Clock,
  Target,
  User,
  Database,
  Theater,
} from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import { BehavioralMemory } from "./BehavioralMemory";
import { CharacterResearchPanel } from "./CharacterResearchPanel";
import type { Summary, IntentAnalysis } from "../../types/chat";

interface ContextSidebarProps {
  conversationId: string | null;
  realtimeIntentAnalysis?: IntentAnalysis | null;
  realtimeSummaries?: Summary[];
  isPingingActive?: boolean;
  pingError?: string | null;
}

export function ContextSidebar({
  conversationId,
  realtimeIntentAnalysis,
  realtimeSummaries = [],
  isPingingActive = false,
  pingError,
}: ContextSidebarProps) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [intentAnalyses, setIntentAnalyses] = useState<IntentAnalysis[]>([]);
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);
  const [isLoadingIntents, setIsLoadingIntents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Merge real-time data with existing data
  const displaySummaries =
    realtimeSummaries.length > 0 ? realtimeSummaries : summaries;
  const displayIntentAnalyses = realtimeIntentAnalysis
    ? [
        realtimeIntentAnalysis,
        ...intentAnalyses.filter((ia) => ia.id !== realtimeIntentAnalysis.id),
      ]
    : intentAnalyses;

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

  const getSummaryLevelColor = (level: number) => {
    switch (level) {
      case 1:
        return "bg-blue-50 text-blue-700 border-blue-200";
      case 2:
        return "bg-purple-50 text-purple-700 border-purple-200";
      case 3:
        return "bg-orange-50 text-orange-700 border-orange-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  if (!conversationId) {
    return (
      <Card className="w-80 h-full rounded-none">
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
        {(error || pingError) && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error || pingError}</AlertDescription>
          </Alert>
        )}

        {isPingingActive && (
          <div className="mx-4 mb-2">
            <Badge variant="outline" className="text-xs">
              <Clock className="mr-1 w-3 h-3" />
              Live Updates Active
            </Badge>
          </div>
        )}

        <Tabs defaultValue="behavioral" className="h-full">
          <TabsList className="grid grid-cols-4 mx-2">
            <TabsTrigger
              value="behavioral"
              className="flex gap-1 items-center text-xs"
            >
              <User className="w-3 h-3" />
              Behavioral
            </TabsTrigger>
            <TabsTrigger
              value="roleplay"
              className="flex gap-1 items-center text-xs"
            >
              <Theater className="w-3 h-3" />
              Character
            </TabsTrigger>
            <TabsTrigger
              value="intent"
              className="flex gap-1 items-center text-xs"
            >
              <Target className="w-3 h-3" />
              Intent
            </TabsTrigger>
            <TabsTrigger
              value="summaries"
              className="flex gap-1 items-center text-xs"
            >
              <FileText className="w-3 h-3" />
              Summaries
            </TabsTrigger>
          </TabsList>

          <TabsContent value="behavioral" className="mt-0">
            <ScrollArea className="h-[calc(100vh-200px)]">
              <BehavioralMemory conversationId={conversationId} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="roleplay" className="mt-0">
            <CharacterResearchPanel conversationId={conversationId} />
          </TabsContent>

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
                ) : displayIntentAnalyses.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <p>No intent analyses found</p>
                  </div>
                ) : (
                  displayIntentAnalyses.map((analysis) => {
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
                              <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                                Intent
                              </h4>
                              <p className="text-sm leading-tight">
                                {result.currentIntent || analysis.currentIntent}
                              </p>
                            </div>

                            {/* Key Topics */}
                            {(result.keyTopics || analysis.keyTopics)?.length >
                              0 && (
                              <div>
                                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                                  Topics
                                </h4>
                                <div className="flex flex-wrap gap-1">
                                  {(result.keyTopics || analysis.keyTopics).map(
                                    (topic: string, index: number) => (
                                      <Badge
                                        key={index}
                                        variant="secondary"
                                        className="text-xs px-2 py-0.5 h-auto"
                                      >
                                        {topic}
                                      </Badge>
                                    )
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Contextual Relevance */}
                            <div className="flex justify-between items-center">
                              <h4 className="text-xs font-medium text-muted-foreground">
                                Relevance
                              </h4>
                              <Badge
                                variant="outline"
                                className={`text-xs px-2 py-0.5 h-auto ${
                                  result.contextualRelevance === "high"
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : result.contextualRelevance === "medium"
                                    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                    : result.contextualRelevance === "low"
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : ""
                                }`}
                              >
                                {result.contextualRelevance ||
                                  (typeof analysis.contextualRelevance ===
                                  "number"
                                    ? `${(
                                        analysis.contextualRelevance * 100
                                      ).toFixed(0)}%`
                                    : "N/A")}
                              </Badge>
                            </div>

                            {/* Relationship to History */}
                            {result.relationshipToHistory && (
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-medium text-muted-foreground">
                                  Relationship
                                </h4>
                                <Badge
                                  variant="outline"
                                  className="text-xs px-2 py-0.5 h-auto"
                                >
                                  {result.relationshipToHistory}
                                </Badge>
                              </div>
                            )}

                            {/* Pending Questions */}
                            {(
                              result.pendingQuestions ||
                              analysis.pendingQuestions
                            )?.length > 0 && (
                              <div>
                                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                                  Pending Questions
                                </h4>
                                <ul className="space-y-0.5 text-xs text-muted-foreground">
                                  {(
                                    result.pendingQuestions ||
                                    analysis.pendingQuestions
                                  ).map((question: string, index: number) => (
                                    <li key={index} className="leading-tight">
                                      • {question}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Last Assistant Question */}
                            {result.lastAssistantQuestion && (
                              <div>
                                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                                  Last Question
                                </h4>
                                <p className="text-xs leading-tight text-muted-foreground">
                                  {result.lastAssistantQuestion}
                                </p>
                              </div>
                            )}

                            {/* Compressed Context */}
                            {result.compressedContext && (
                              <div>
                                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                                  Context
                                </h4>
                                <p className="text-xs leading-tight text-muted-foreground">
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
                ) : displaySummaries.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <p>No summaries found</p>
                  </div>
                ) : (
                  displaySummaries.map((summary) => (
                    <Card
                      key={summary.id}
                      className="border-l-4 border-l-blue-500"
                    >
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          {/* Header with Summary Level and Message Count */}
                          <div className="flex gap-2 justify-between items-start">
                            <Badge
                              variant="outline"
                              className={`text-xs px-2 py-0.5 h-auto ${getSummaryLevelColor(
                                summary.summaryLevel
                              )}`}
                            >
                              Level {summary.summaryLevel}
                              {summary.summaryLevel === 1
                                ? " (Original)"
                                : " (Meta)"}
                            </Badge>
                            <Badge
                              variant="secondary"
                              className="text-xs px-2 py-0.5 h-auto"
                            >
                              {summary.messageRange.messageCount} messages
                            </Badge>
                          </div>

                          {/* Summary Text */}
                          <div>
                            <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                              Summary
                            </h4>
                            <p className="text-sm leading-tight text-muted-foreground">
                              {summary.summaryText}
                            </p>
                          </div>

                          {/* Topic Information */}
                          {summary.topicName && (
                            <div>
                              <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                                Topic
                              </h4>
                              <div className="flex flex-wrap gap-1 mb-2">
                                <Badge
                                  variant="default"
                                  className="text-xs px-2 py-0.5 h-auto"
                                >
                                  {summary.topicName}
                                </Badge>
                                {summary.topicRelevance && (
                                  <Badge
                                    variant="outline"
                                    className={`text-xs px-2 py-0.5 h-auto ${
                                      summary.topicRelevance >= 0.8
                                        ? "bg-green-50 text-green-700 border-green-200"
                                        : summary.topicRelevance >= 0.6
                                        ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                        : "bg-red-50 text-red-700 border-red-200"
                                    }`}
                                  >
                                    {(summary.topicRelevance * 100).toFixed(0)}%
                                    relevant
                                  </Badge>
                                )}
                              </div>
                              {summary.relatedTopics &&
                                summary.relatedTopics.length > 0 && (
                                  <div>
                                    <h5 className="mb-1 text-xs font-medium text-muted-foreground">
                                      Related Topics
                                    </h5>
                                    <div className="flex flex-wrap gap-1">
                                      {summary.relatedTopics.map(
                                        (topic: string, index: number) => (
                                          <Badge
                                            key={index}
                                            variant="secondary"
                                            className="text-xs px-2 py-0.5 h-auto"
                                          >
                                            {topic}
                                          </Badge>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                            </div>
                          )}

                          {/* Message Range Info */}
                          <div className="flex justify-between items-center text-xs text-muted-foreground">
                            <div className="flex gap-1 items-center">
                              <Target className="w-3 h-3" />
                              <span>
                                Range: {summary.messageRange.messageCount} msgs
                              </span>
                            </div>
                            <div className="flex gap-1 items-center">
                              <Clock className="w-3 h-3" />
                              {formatDate(summary.createdAt)}
                            </div>
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
