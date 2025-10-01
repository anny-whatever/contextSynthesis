import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Brain,
  User,
  MessageSquare,
  Sparkles,
  BookOpen,
  Users,
  X,
  AlertCircle,
} from "lucide-react";

interface CharacterKnowledgeModalProps {
  conversationId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface CharacterKnowledge {
  id: string;
  characterName: string;
  characterSource: string;
  knowledgeGraph: {
    characterId: string;
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
    metadata?: any;
  }>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function CharacterKnowledgeModal({
  conversationId,
  isOpen,
  onClose,
}: CharacterKnowledgeModalProps) {
  const [characterKnowledge, setCharacterKnowledge] =
    useState<CharacterKnowledge | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && conversationId) {
      loadCharacterKnowledge();
    }
  }, [isOpen, conversationId]);

  const loadCharacterKnowledge = async () => {
    if (!conversationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/character/${conversationId}`);
      const data = await response.json();

      if (data.success) {
        setCharacterKnowledge(data.data);
      } else {
        setError(data.error || "Failed to load character knowledge");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load character knowledge"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!conversationId) return;

    try {
      const response = await fetch(`/api/character/${conversationId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (data.success) {
        setCharacterKnowledge(null);
        onClose();
      } else {
        setError("Failed to deactivate character");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to deactivate character"
      );
    }
  };

  const getChunkTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "personality":
        return <User className="w-4 h-4" />;
      case "catchphrase":
        return <MessageSquare className="w-4 h-4" />;
      case "expertise":
        return <Brain className="w-4 h-4" />;
      case "backstory":
        return <BookOpen className="w-4 h-4" />;
      case "relationship":
        return <Users className="w-4 h-4" />;
      default:
        return <Sparkles className="w-4 h-4" />;
    }
  };

  const getChunkTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "personality":
        return "bg-purple-500/10 text-purple-700 border-purple-500/20";
      case "catchphrase":
        return "bg-blue-500/10 text-blue-700 border-blue-500/20";
      case "expertise":
        return "bg-green-500/10 text-green-700 border-green-500/20";
      case "backstory":
        return "bg-amber-500/10 text-amber-700 border-amber-500/20";
      case "relationship":
        return "bg-pink-500/10 text-pink-700 border-pink-500/20";
      default:
        return "bg-gray-500/10 text-gray-700 border-gray-500/20";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex justify-between items-center">
            <div>
              <DialogTitle className="flex gap-2 items-center">
                <Sparkles className="w-5 h-5 text-purple-600" />
                Character Knowledge
              </DialogTitle>
              <DialogDescription>
                View the knowledge graph and context for this character roleplay
              </DialogDescription>
            </div>
            {/* <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button> */}
          </div>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 w-12 h-12 rounded-full border-b-2 border-purple-600 animate-spin" />
              <p className="text-sm text-muted-foreground">
                Loading character knowledge...
              </p>
            </div>
          </div>
        ) : !characterKnowledge ? (
          <div className="flex flex-col justify-center items-center py-12">
            <Brain className="mb-4 w-16 h-16 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No character knowledge found for this conversation
            </p>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="attributes">Attributes</TabsTrigger>
              <TabsTrigger value="chunks">Knowledge Chunks</TabsTrigger>
              <TabsTrigger value="prompt">System Prompt</TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[500px] mt-4">
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
                          {
                            characterKnowledge.knowledgeGraph.basicInfo
                              .occupation
                          }
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
                <Card>
                  <CardHeader>
                    <CardTitle className="flex gap-2 items-center">
                      <MessageSquare className="w-5 h-5" />
                      Catchphrases
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 list-disc list-inside">
                      {characterKnowledge.knowledgeGraph.attributes.catchphrases.map(
                        (phrase, idx) => (
                          <li key={idx} className="text-sm">
                            "{phrase}"
                          </li>
                        )
                      )}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex gap-2 items-center">
                      <Brain className="w-5 h-5" />
                      Traits
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="mb-1 text-sm font-medium text-muted-foreground">
                        Communication Style
                      </p>
                      <p className="text-sm">
                        {
                          characterKnowledge.knowledgeGraph.attributes.traits
                            .communication
                        }
                      </p>
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-medium text-muted-foreground">
                        Expertise
                      </p>
                      <p className="text-sm">
                        {
                          characterKnowledge.knowledgeGraph.attributes.traits
                            .expertise
                        }
                      </p>
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-medium text-muted-foreground">
                        Quirks
                      </p>
                      <p className="text-sm">
                        {
                          characterKnowledge.knowledgeGraph.attributes.traits
                            .quirks
                        }
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {characterKnowledge.knowledgeGraph.attributes.relationships
                  .length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex gap-2 items-center">
                        <Users className="w-5 h-5" />
                        Relationships
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {characterKnowledge.knowledgeGraph.attributes.relationships.map(
                        (rel, idx) => (
                          <div
                            key={idx}
                            className="pl-3 border-l-2 border-purple-500"
                          >
                            <p className="text-sm font-medium">{rel.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {rel.type}
                            </p>
                            <p className="mt-1 text-sm">{rel.dynamic}</p>
                          </div>
                        )
                      )}
                    </CardContent>
                  </Card>
                )}

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

              <TabsContent value="chunks" className="space-y-3">
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
                      <div
                        className={`p-3 rounded-lg border ${getChunkTypeColor(
                          chunk.chunkType
                        )}`}
                      >
                        <p className="text-sm leading-relaxed">
                          {chunk.content}
                        </p>
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

        {characterKnowledge && (
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-xs text-muted-foreground">
              Created{" "}
              {new Date(characterKnowledge.createdAt).toLocaleDateString()}
            </div>
            <Button variant="destructive" onClick={handleDeactivate}>
              Deactivate Character
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

