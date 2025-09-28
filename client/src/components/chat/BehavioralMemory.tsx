import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Skeleton } from "../ui/skeleton";
import { AlertCircle, Save, RefreshCw, Brain, Edit } from "lucide-react";
import { ChatApiService } from "../../services/chatApi";

interface BehavioralMemoryProps {
  conversationId: string | null;
}

export function BehavioralMemory({ conversationId }: BehavioralMemoryProps) {
  const [behavioralMemory, setBehavioralMemory] = useState("");
  const [originalMemory, setOriginalMemory] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Load behavioral memory when conversation changes
  useEffect(() => {
    if (conversationId) {
      loadBehavioralMemory();
    } else {
      resetState();
    }
  }, [conversationId]);

  // Update word count and detect changes
  useEffect(() => {
    const trimmedMemory = behavioralMemory.trim();
    const count = trimmedMemory ? trimmedMemory.split(/\s+/).length : 0;
    setWordCount(count);
    setHasChanges(trimmedMemory !== originalMemory.trim());

    // Clear success message when user starts typing
    if (successMessage && trimmedMemory !== originalMemory.trim()) {
      setSuccessMessage(null);
    }
  }, [behavioralMemory, originalMemory, successMessage]);

  const resetState = () => {
    setBehavioralMemory("");
    setOriginalMemory("");
    setWordCount(0);
    setError(null);
    setSuccessMessage(null);
    setHasChanges(false);
    setIsEditing(false);
  };

  const loadBehavioralMemory = async () => {
    if (!conversationId) return;

    try {
      setIsLoading(true);
      setError(null);
      const response = await ChatApiService.getBehavioralMemory(conversationId);
      const memory = response.data.behavioralMemory || "";
      setBehavioralMemory(memory);
      setOriginalMemory(memory);
      setWordCount(response.data.wordCount);
      setHasChanges(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load behavioral memory"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const saveBehavioralMemory = async () => {
    if (!conversationId) return;

    try {
      setIsSaving(true);
      setError(null);
      setSuccessMessage(null);

      const response = await ChatApiService.updateBehavioralMemory(
        conversationId,
        behavioralMemory
      );

      setOriginalMemory(behavioralMemory);
      setHasChanges(false);
      setSuccessMessage("Behavioral memory saved successfully!");
      setIsEditing(false);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save behavioral memory"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setBehavioralMemory(originalMemory);
    setHasChanges(false);
    setIsEditing(false);
    setSuccessMessage(null);
  };

  const getWordCountColor = () => {
    if (wordCount > 300) return "text-red-600";
    if (wordCount > 250) return "text-orange-600";
    return "text-muted-foreground";
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBehavioralMemory(e.target.value);
    if (!isEditing) setIsEditing(true);
  };

  if (!conversationId) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-muted-foreground">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Select a conversation to view behavioral memory</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4" />
          <h3 className="text-sm font-medium">Behavioral Memory</h3>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <Badge variant="outline" className="text-xs">
              <Edit className="w-3 h-3 mr-1" />
              Editing
            </Badge>
          )}
          <Badge variant="outline" className={`text-xs ${getWordCountColor()}`}>
            {wordCount}/300 words
          </Badge>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {successMessage && (
        <Alert className="bg-green-50 text-green-800 border-green-200">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription className="text-sm">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading ? (
        <Card>
          <CardContent className="p-4">
            <Skeleton className="w-full h-32" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-4">
            {/* Description */}
            <p className="text-xs text-muted-foreground">
              This memory captures your communication preferences and behavioral
              patterns for this conversation. It helps the AI adapt its tone,
              style, and approach to match your preferences.
            </p>

            {/* Textarea */}
            <Textarea
              value={behavioralMemory}
              onChange={handleTextareaChange}
              placeholder="The AI will automatically update this memory based on your interactions. You can also edit it manually to specify your preferences..."
              className="min-h-[200px] text-sm"
              disabled={isSaving}
            />

            {/* Action Buttons */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={loadBehavioralMemory}
                disabled={isLoading || isSaving}
                className="text-xs"
              >
                <RefreshCw
                  className={`w-3 h-3 mr-1 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>

              <div className="flex gap-2">
                {hasChanges && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDiscard}
                    disabled={isSaving}
                    className="text-xs"
                  >
                    Discard
                  </Button>
                )}

                <Button
                  onClick={saveBehavioralMemory}
                  disabled={!hasChanges || isSaving || wordCount > 300}
                  size="sm"
                  className="text-xs"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Word count warning */}
            {wordCount > 250 && (
              <p className={`text-xs ${getWordCountColor()}`}>
                {wordCount > 300
                  ? "⚠️ Memory too long. Please reduce to 300 words or less."
                  : `⚠️ Approaching word limit. ${
                      300 - wordCount
                    } words remaining.`}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
