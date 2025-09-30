import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Plus,
  Search,
  CheckCircle,
  AlertCircle,
  User,
  BookOpen,
  Users,
  MessageSquare,
  Brain,
  Sparkles,
  Trash2,
  Zap,
  Eye,
  Calendar,
} from "lucide-react";
import { ChatApiService } from "../../services/chatApi";

interface CharacterResearchPanelProps {
  conversationId: string | null;
}

interface CharacterKnowledge {
  id: string;
  characterName: string;
  characterSource: string;
  knowledgeGraph: {
    basicInfo: {
      name: string;
      source: string;
      occupation?: string;
      personality: string[];
    };
    attributes: {
      catchphrases: string[];
      relationships: Array<{
        name: string;
        type: string;
        dynamic: string;
      }>;
      traits: {
        communication: string;
        expertise: string;
        quirks: string;
      };
      backstory: string;
    };
  };
  systemPrompt: string;
  chunks: Array<{
    id: string;
    chunkType: string;
    content: string;
    tokenCount: number;
  }>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function CharacterResearchPanel({
  conversationId,
}: CharacterResearchPanelProps) {
  const [characterKnowledge, setCharacterKnowledge] =
    useState<CharacterKnowledge | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isResearching, setIsResearching] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    characterName: "",
    characterSource: "",
  });

  // Load character knowledge
  useEffect(() => {
    if (conversationId) {
      loadCharacterKnowledge();
    } else {
      setCharacterKnowledge(null);
    }
  }, [conversationId]);

  const loadCharacterKnowledge = async () => {
    if (!conversationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await ChatApiService.getCharacterKnowledge(
        conversationId
      );
      if (response.success) {
        setCharacterKnowledge(response.data);
      } else {
        setCharacterKnowledge(null);
      }
    } catch (err) {
      console.error("Error loading character knowledge:", err);
      setCharacterKnowledge(null);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      characterName: "",
      characterSource: "",
    });
  };

  const openCreateDialog = () => {
    resetForm();
    setError(null);
    setSuccessMessage(null);
    setIsCreateDialogOpen(true);
  };

  const handleResearchCharacter = async () => {
    if (!conversationId || !formData.characterName.trim()) {
      setError("Character name is required for research");
      return;
    }

    setIsResearching(true);
    setError(null);

    try {
      const response = await ChatApiService.researchCharacter(conversationId, {
        characterName: formData.characterName,
        characterSource: formData.characterSource || undefined,
      });

      if (response.success) {
        setSuccessMessage(
          `Character research completed for ${formData.characterName}!`
        );
        setIsCreateDialogOpen(false);
        resetForm();
        await loadCharacterKnowledge();
      } else {
        setError("Failed to research character");
      }
    } catch (err) {
      setError("Error researching character");
      console.error("Error researching character:", err);
    } finally {
      setIsResearching(false);
    }
  };

  const handleDeleteCharacter = async () => {
    if (!conversationId || !characterKnowledge) return;

    try {
      const response = await ChatApiService.deactivateCharacterKnowledge(
        conversationId
      );
      if (response.success) {
        setCharacterKnowledge(null);
        setSuccessMessage("Character knowledge removed successfully");
      } else {
        setError("Failed to remove character knowledge");
      }
    } catch (err) {
      setError("Error removing character");
      console.error("Error removing character:", err);
    }
  };

  const getChunkTypeIcon = (chunkType: string) => {
    switch (chunkType.toLowerCase()) {
      case "personality":
        return <User className="w-4 h-4" />;
      case "relationships":
        return <Users className="w-4 h-4" />;
      case "catchphrases":
        return <MessageSquare className="w-4 h-4" />;
      case "backstory":
        return <BookOpen className="w-4 h-4" />;
      default:
        return <Brain className="w-4 h-4" />;
    }
  };

  const getChunkTypeColor = (chunkType: string) => {
    switch (chunkType.toLowerCase()) {
      case "personality":
        return "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800";
      case "relationships":
        return "bg-pink-50 border-pink-200 dark:bg-pink-950/20 dark:border-pink-800";
      case "catchphrases":
        return "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800";
      case "backstory":
        return "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800";
      default:
        return "bg-gray-50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800";
    }
  };

  if (!conversationId) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-muted-foreground">
          <Search className="mx-auto mb-4 w-12 h-12 opacity-50" />
          <h3 className="mb-2 text-lg font-medium">No Conversation Selected</h3>
          <p>Select a conversation to research characters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header Section */}
      <div className="flex-shrink-0 p-4 border-b">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Character Research</h2>
              <p className="text-xs text-muted-foreground">
                AI-powered character knowledge
              </p>
            </div>
          </div>
          {!characterKnowledge && (
            <Button
              onClick={openCreateDialog}
              size="sm"
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            >
              <Search className="mr-2 w-3 h-3" />
              Research
            </Button>
          )}
        </div>

        {/* Messages */}
        {successMessage && (
          <Alert className="mb-3 bg-green-50 border-green-200 dark:bg-green-950/20">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200 text-sm">
              {successMessage}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Content Section */}
      <div className="flex-1 overflow-auto p-4">
        {/* Loading State */}
        {isLoading && (
          <Card>
            <CardContent className="p-4">
              <Skeleton className="mb-2 w-1/3 h-5" />
              <Skeleton className="mb-2 w-full h-3" />
              <Skeleton className="w-2/3 h-3" />
            </CardContent>
          </Card>
        )}

        {/* No Character State */}
        {!isLoading && !characterKnowledge && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <div className="inline-flex p-3 mb-3 bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-full">
                <Search className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">No Character Yet</h3>
              <p className="mb-4 text-sm text-muted-foreground max-w-sm mx-auto">
                Research a character to unlock AI-powered knowledge including
                personality, relationships, and more
              </p>
              <Button
                onClick={openCreateDialog}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
              >
                <Search className="mr-2 w-4 h-4" />
                Start Research
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Character Summary Card */}
        {!isLoading && characterKnowledge && (
          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl mb-1">
                      {characterKnowledge.characterName}
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {characterKnowledge.characterSource}
                    </Badge>
                    {characterKnowledge.knowledgeGraph.basicInfo.occupation && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {characterKnowledge.knowledgeGraph.basicInfo.occupation}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteCharacter}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Personality Traits */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Personality Traits
                </p>
                <div className="flex flex-wrap gap-1">
                  {characterKnowledge.knowledgeGraph.basicInfo.personality
                    .slice(0, 4)
                    .map((trait, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className="text-xs bg-purple-50 dark:bg-purple-950/30"
                      >
                        {trait}
                      </Badge>
                    ))}
                  {characterKnowledge.knowledgeGraph.basicInfo.personality
                    .length > 4 && (
                    <Badge variant="outline" className="text-xs">
                      +
                      {characterKnowledge.knowledgeGraph.basicInfo.personality
                        .length - 4}{" "}
                      more
                    </Badge>
                  )}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2 bg-muted/50 rounded-lg">
                  <p className="text-lg font-bold text-blue-600">
                    {
                      characterKnowledge.knowledgeGraph.attributes.catchphrases
                        .length
                    }
                  </p>
                  <p className="text-xs text-muted-foreground">Catchphrases</p>
                </div>
                <div className="p-2 bg-muted/50 rounded-lg">
                  <p className="text-lg font-bold text-pink-600">
                    {
                      characterKnowledge.knowledgeGraph.attributes.relationships
                        .length
                    }
                  </p>
                  <p className="text-xs text-muted-foreground">Relationships</p>
                </div>
                <div className="p-2 bg-muted/50 rounded-lg">
                  <p className="text-lg font-bold text-green-600">
                    {characterKnowledge.chunks.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Knowledge</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => setIsDetailsModalOpen(true)}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                >
                  <Eye className="mr-2 w-4 h-4" />
                  View Details
                </Button>
                <Button
                  variant="outline"
                  onClick={openCreateDialog}
                  className="border-purple-200 hover:bg-purple-50"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Created Date */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1 border-t">
                <Calendar className="w-3 h-3" />
                Created {new Date(characterKnowledge.createdAt).toLocaleDateString()}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Research Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5 text-purple-600" />
              Research Character
            </DialogTitle>
            <DialogDescription>
              Enter a character name to research and create an AI-powered
              knowledge graph
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="characterName" className="text-sm font-medium">
                Character Name *
              </Label>
              <Input
                id="characterName"
                value={formData.characterName}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    characterName: e.target.value,
                  }))
                }
                placeholder="e.g., Sherlock Holmes, Naruto Uzumaki"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="characterSource" className="text-sm font-medium">
                Source (Optional)
              </Label>
              <Input
                id="characterSource"
                value={formData.characterSource}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    characterSource: e.target.value,
                  }))
                }
                placeholder="e.g., BBC Sherlock, Naruto Shippuden"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Adding a source helps get more accurate results
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isResearching}
            >
              Cancel
            </Button>
            <Button
              onClick={handleResearchCharacter}
              disabled={isResearching || !formData.characterName.trim()}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            >
              {isResearching ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Researching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Research Character
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Character Details Modal */}
      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-purple-600" />
              {characterKnowledge?.characterName} - Character Details
            </DialogTitle>
            <DialogDescription>
              Comprehensive AI-generated character knowledge and analysis
            </DialogDescription>
          </DialogHeader>

          {characterKnowledge && (
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="attributes">Attributes</TabsTrigger>
                <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
                <TabsTrigger value="prompt">System Prompt</TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[60vh] mt-4">
                <TabsContent value="overview" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex gap-2 items-center">
                        <User className="w-5 h-5" />
                        {characterKnowledge.characterName}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="mb-1 text-sm font-medium text-muted-foreground">
                          Source
                        </p>
                        <Badge variant="secondary">
                          {characterKnowledge.characterSource}
                        </Badge>
                      </div>

                      {characterKnowledge.knowledgeGraph.basicInfo.occupation && (
                        <div>
                          <p className="mb-1 text-sm font-medium text-muted-foreground">
                            Occupation
                          </p>
                          <p className="text-sm">
                            {characterKnowledge.knowledgeGraph.basicInfo.occupation}
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 text-sm font-medium text-muted-foreground">
                          Personality Traits
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {characterKnowledge.knowledgeGraph.basicInfo.personality.map(
                            (trait, idx) => (
                              <Badge key={idx} variant="outline">
                                {trait}
                              </Badge>
                            )
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="mb-1 text-sm font-medium text-muted-foreground">
                          Total Knowledge Chunks
                        </p>
                        <p className="text-2xl font-bold text-purple-600">
                          {characterKnowledge.chunks.length}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="attributes" className="space-y-4">
                  {/* Traits */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex gap-2 items-center">
                        <Zap className="w-5 h-5" />
                        Character Traits
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <p className="mb-1 text-sm font-medium text-muted-foreground">
                          Communication Style
                        </p>
                        <p className="text-sm">
                          {characterKnowledge.knowledgeGraph.attributes.traits.communication}
                        </p>
                      </div>
                      <Separator />
                      <div>
                        <p className="mb-1 text-sm font-medium text-muted-foreground">
                          Expertise
                        </p>
                        <p className="text-sm">
                          {characterKnowledge.knowledgeGraph.attributes.traits.expertise}
                        </p>
                      </div>
                      <Separator />
                      <div>
                        <p className="mb-1 text-sm font-medium text-muted-foreground">
                          Quirks
                        </p>
                        <p className="text-sm">
                          {characterKnowledge.knowledgeGraph.attributes.traits.quirks}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Catchphrases */}
                  {characterKnowledge.knowledgeGraph.attributes.catchphrases.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex gap-2 items-center">
                          <MessageSquare className="w-5 h-5" />
                          Signature Catchphrases
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {characterKnowledge.knowledgeGraph.attributes.catchphrases.map(
                            (phrase, idx) => (
                              <div
                                key={idx}
                                className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900"
                              >
                                <p className="text-sm italic">"{phrase}"</p>
                              </div>
                            )
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Relationships */}
                  {characterKnowledge.knowledgeGraph.attributes.relationships.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex gap-2 items-center">
                          <Users className="w-5 h-5" />
                          Key Relationships
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {characterKnowledge.knowledgeGraph.attributes.relationships.map(
                          (rel, idx) => (
                            <div key={idx} className="pl-3 border-l-2 border-pink-500">
                              <p className="text-sm font-medium">{rel.name}</p>
                              <p className="text-xs text-muted-foreground">{rel.type}</p>
                              <p className="mt-1 text-sm">{rel.dynamic}</p>
                            </div>
                          )
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Backstory */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex gap-2 items-center">
                        <BookOpen className="w-5 h-5" />
                        Backstory
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">
                        {characterKnowledge.knowledgeGraph.attributes.backstory}
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="knowledge" className="space-y-3">
                  {characterKnowledge.chunks.map((chunk) => (
                    <Card key={chunk.id}>
                      <CardHeader>
                        <div className="flex justify-between items-center">
                          <div className="flex gap-2 items-center">
                            {getChunkTypeIcon(chunk.chunkType)}
                            <span className="text-sm font-medium capitalize">
                              {chunk.chunkType}
                            </span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {chunk.tokenCount} tokens
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className={`p-3 rounded-lg border ${getChunkTypeColor(chunk.chunkType)}`}>
                          <p className="text-sm leading-relaxed">{chunk.content}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="prompt" className="space-y-3">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex gap-2 items-center">
                        <Sparkles className="w-5 h-5" />
                        System Prompt
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="p-4 rounded-lg bg-muted">
                        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
                          {characterKnowledge.systemPrompt}
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
