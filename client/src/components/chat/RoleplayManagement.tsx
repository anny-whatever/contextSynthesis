import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { ScrollArea } from "../ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Plus,
  Theater,
  Sparkles,
  Brain,
  Globe,
  Search,
  CheckCircle2,
  CheckCircle,
  AlertCircle,
  Save,
  Edit,
  Trash2,
  Play,
  Square,
  MoreVertical,
  User,
  BookOpen,
  Settings,
  Database,
  Users,
  Eye,
  EyeOff,
  Pause,
} from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Roleplay } from "../../types/chat";

interface RoleplayManagementProps {
  conversationId: string | null;
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

export function RoleplayManagement({
  conversationId,
}: RoleplayManagementProps) {
  const [roleplays, setRoleplays] = useState<Roleplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Find active roleplay
  const activeRoleplay = roleplays.find(r => r.isActive);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoleplay, setEditingRoleplay] = useState<Roleplay | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [characterKnowledge, setCharacterKnowledge] = useState<CharacterKnowledge | null>(null);
  const [showCharacterDetails, setShowCharacterDetails] = useState<string | null>(null);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    characterName: "",
    characterSource: "",
  });

  const [creationMode, setCreationMode] = useState<"generic" | "character">("generic");

  useEffect(() => {
    if (conversationId) {
      loadRoleplays();
      loadCharacterKnowledge();
    }
  }, [conversationId]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const loadRoleplays = async () => {
    if (!conversationId) return;

    try {
      setIsLoading(true);
      setError(null);
      const response = await ChatApiService.getRoleplays(conversationId);
      setRoleplays(response.data.roleplays);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roleplays");
    } finally {
      setIsLoading(false);
    }
  };

  const loadCharacterKnowledge = async () => {
    if (!conversationId) return;

    try {
      setIsLoadingCharacter(true);
      const response = await fetch(`/api/character/${conversationId}`);
      const data = await response.json();

      if (data.success) {
        setCharacterKnowledge(data.data);
      }
    } catch (err) {
      console.error("Failed to load character knowledge:", err);
    } finally {
      setIsLoadingCharacter(false);
    }
  };

  const countWords = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  const canEnhance = formData.name.trim() && formData.description.trim();
  const canResearch = formData.characterName.trim();

  const handleResearchCharacter = async () => {
    if (!conversationId || !canResearch) return;

    setIsResearching(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/character/${conversationId}/research`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            characterName: formData.characterName.trim(),
            characterSource: formData.characterSource.trim() || undefined,
          }),
        }
      );

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(
          `Character "${formData.characterName}" researched successfully! Knowledge graph created with ${data.data.chunkCount} chunks.`
        );

        setFormData({
          ...formData,
          name: data.data.characterName,
          description: `Character roleplay: ${data.data.characterName}${
            data.data.characterSource
              ? ` from ${data.data.characterSource}`
              : ""
          }`,
          systemPrompt: data.data.systemPrompt,
        });

        setTimeout(() => {
          setIsDialogOpen(false);
          loadRoleplays();
          loadCharacterKnowledge();
        }, 1500);
      } else {
        setError(
          data.error ||
            "Failed to research character. Please check the name and try again."
        );
      }
    } catch (error) {
      console.error("Character research error:", error);
      setError(
        "Failed to research character. Please ensure the character name is searchable."
      );
    } finally {
      setIsResearching(false);
    }
  };

  const handleEnhanceRoleplay = async () => {
    if (!conversationId || !canEnhance) return;

    setIsEnhancing(true);
    setError(null);

    try {
      const response = await fetch(`/api/chat/${conversationId}/enhance-roleplay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseRole: `${formData.name}: ${formData.description}`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setFormData({
          ...formData,
          systemPrompt: data.data.enhancedInstructions,
        });
        setSuccessMessage("Roleplay enhanced successfully!");
      } else {
        setError(data.error?.message || "Failed to enhance roleplay");
      }
    } catch (error) {
      console.error("Enhancement error:", error);
      setError("Failed to enhance roleplay. Please try again.");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSubmit = async () => {
    if (!conversationId) return;

    try {
      setError(null);
      const roleplayData = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        isActive: false, // Default to inactive when creating
      };

      let response;
      if (editingRoleplay) {
        response = await ChatApiService.updateRoleplay(
          conversationId,
          editingRoleplay.id,
          roleplayData
        );
      } else {
        response = await ChatApiService.createRoleplay(conversationId, roleplayData);
      }

      setSuccessMessage(
        editingRoleplay
          ? "Roleplay updated successfully!"
          : "Roleplay created successfully!"
      );
      setIsDialogOpen(false);
      resetForm();
      loadRoleplays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save roleplay");
    }
  };

  const handleActivateRoleplay = async (roleplayId: string) => {
    if (!conversationId) return;

    try {
      setError(null);
      // Find the current roleplay to toggle its active state
      const currentRoleplay = roleplays.find(r => r.id === roleplayId);
      if (!currentRoleplay) return;

      await ChatApiService.updateRoleplay(conversationId, roleplayId, {
        isActive: !currentRoleplay.isActive
      });
      
      setSuccessMessage(
        currentRoleplay.isActive 
          ? "Roleplay deactivated successfully!" 
          : "Roleplay activated successfully!"
      );
      loadRoleplays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update roleplay");
    }
  };

  const handleDeleteRoleplay = async (roleplayId: string) => {
    if (!conversationId) return;

    try {
      setError(null);
      await ChatApiService.deleteRoleplay(conversationId, roleplayId);
      setSuccessMessage("Roleplay deleted successfully!");
      loadRoleplays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete roleplay");
    }
  };

  const handleEditRoleplay = (roleplay: Roleplay) => {
    setEditingRoleplay(roleplay);
    setFormData({
      name: roleplay.name,
      description: roleplay.description,
      systemPrompt: roleplay.systemPrompt,
      characterName: "",
      characterSource: "",
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    resetForm();
    setEditingRoleplay(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (roleplay: Roleplay) => {
    setFormData({
      name: roleplay.name,
      description: roleplay.description,
      systemPrompt: roleplay.systemPrompt,
      characterName: "",
      characterSource: "",
    });
    setEditingRoleplay(roleplay);
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      systemPrompt: "",
      characterName: "",
      characterSource: "",
    });
    setCreationMode("generic");
    setError(null);
    setSuccessMessage(null);
  };

  const toggleCharacterDetails = (roleplayId: string) => {
    setShowCharacterDetails(showCharacterDetails === roleplayId ? null : roleplayId);
  };

  if (!conversationId) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-muted-foreground">
          <Theater className="mx-auto mb-4 w-12 h-12 opacity-50" />
          <h3 className="mb-2 text-lg font-medium">No Conversation Selected</h3>
          <p>Select a conversation to manage roleplays and characters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header Section */}
      <div className="flex-shrink-0 p-6 border-b bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Roleplay Management
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Create and manage AI roleplay characters with full-width control
            </p>
          </div>
          <Button
            onClick={() => setIsDialogOpen(true)}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Roleplay
          </Button>
        </div>

        {/* Success/Error Messages */}
        {successMessage && (
          <Alert className="mb-4 border-green-200 bg-green-50 dark:bg-green-950/20">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              {successMessage}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6">
            {/* Active Character Section */}
            {activeRoleplay && characterKnowledge && (
              <Card className="mb-8 border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 shadow-lg">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                    <CardTitle className="text-xl text-blue-900 dark:text-blue-100">
                      Active Character: {characterKnowledge.characterName}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-blue-700 dark:text-blue-300">
                    Currently active roleplay character with full knowledge integration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Character Overview */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                          <User className="w-4 h-4" />
                          Character Information
                        </h4>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Source</p>
                          <p className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                            {characterKnowledge.characterSource}
                          </p>
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                             {`${characterKnowledge.knowledgeGraph.basicInfo.name} from ${characterKnowledge.knowledgeGraph.basicInfo.source}`}
                           </p>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          Attributes & Traits
                        </h4>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border space-y-3">
                          <div>
                             <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Attributes</p>
                             <p className="text-sm text-gray-700 dark:text-gray-300">
                               {characterKnowledge.knowledgeGraph.attributes.catchphrases?.join(", ") || "No catchphrases"}
                             </p>
                           </div>
                           <div>
                             <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Traits</p>
                             <p className="text-sm text-gray-700 dark:text-gray-300">
                               {characterKnowledge.knowledgeGraph.attributes.traits?.communication || "No traits available"}
                             </p>
                           </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                          <BookOpen className="w-4 h-4" />
                          Backstory
                        </h4>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
                           <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                             {characterKnowledge.knowledgeGraph.attributes.backstory || "No backstory available"}
                           </p>
                         </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                          <Settings className="w-4 h-4" />
                          System Prompt
                        </h4>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
                          <p className="text-xs font-mono text-gray-600 dark:text-gray-400 leading-relaxed">
                            {characterKnowledge.systemPrompt}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Knowledge Chunks */}
                  {characterKnowledge.chunks && characterKnowledge.chunks.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        Knowledge Base ({characterKnowledge.chunks.length} chunks)
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {characterKnowledge.chunks.slice(0, 6).map((chunk, index) => (
                          <div
                            key={index}
                            className="bg-white dark:bg-gray-800 rounded-lg p-3 border text-xs"
                          >
                            <p className="text-gray-700 dark:text-gray-300 line-clamp-3">
                              {chunk.content}
                            </p>
                            <p className="text-gray-500 dark:text-gray-500 mt-2 text-xs">
                              Tokens: {chunk.tokenCount}
                            </p>
                          </div>
                        ))}
                      </div>
                      {characterKnowledge.chunks.length > 6 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                          +{characterKnowledge.chunks.length - 6} more knowledge chunks available
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Roleplays List */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5" />
                All Roleplays ({roleplays.length})
              </h3>

              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <Card key={i} className="p-4">
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-full mb-2" />
                      <Skeleton className="h-3 w-2/3" />
                    </Card>
                  ))}
                </div>
              ) : roleplays.length === 0 ? (
                <Card className="p-8 text-center border-dashed border-2">
                  <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400 mb-2">No roleplays created yet</p>
                  <p className="text-sm text-gray-400 dark:text-gray-500">
                    Create your first roleplay to get started with character interactions
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roleplays.map((roleplay) => (
                    <Card
                      key={roleplay.id}
                      className={`transition-all duration-200 hover:shadow-lg ${
                        roleplay.isActive
                          ? "border-green-500 bg-green-50 dark:bg-green-950/20 shadow-md"
                          : "hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <CardTitle className="text-base flex items-center gap-2">
                              {roleplay.isActive && (
                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              )}
                              {roleplay.name}
                            </CardTitle>
                            <CardDescription className="text-sm mt-1 line-clamp-2">
                              {roleplay.description}
                            </CardDescription>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditRoleplay(roleplay)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleActivateRoleplay(roleplay.id)}>
                                {roleplay.isActive ? (
                                  <>
                                    <Square className="w-4 h-4 mr-2" />
                                    Deactivate
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-4 h-4 mr-2" />
                                    Activate
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteRoleplay(roleplay.id)}
                                className="text-red-600 dark:text-red-400"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>Created {new Date(roleplay.createdAt).toLocaleDateString()}</span>
                            {roleplay.isActive && (
                              <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                Active
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                            {roleplay.systemPrompt}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Character Knowledge Section */}
      {characterKnowledge && (
        <Card className="border-purple-200 bg-purple-50/50">
          <CardHeader>
            <CardTitle className="flex gap-2 items-center text-purple-900">
              <Brain className="w-5 h-5" />
              Active Character: {characterKnowledge.characterName}
              {characterKnowledge.characterSource && (
                <Badge variant="outline" className="text-purple-700 border-purple-300">
                  {characterKnowledge.characterSource}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h4 className="font-medium text-purple-900 mb-2">Basic Info</h4>
                <div className="space-y-1 text-sm">
                  <p><strong>Name:</strong> {characterKnowledge.knowledgeGraph.basicInfo.name}</p>
                  <p><strong>Source:</strong> {characterKnowledge.knowledgeGraph.basicInfo.source}</p>
                  {characterKnowledge.knowledgeGraph.basicInfo.occupation && (
                    <p><strong>Occupation:</strong> {characterKnowledge.knowledgeGraph.basicInfo.occupation}</p>
                  )}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-purple-900 mb-2">Personality</h4>
                <div className="flex flex-wrap gap-1">
                  {characterKnowledge.knowledgeGraph.basicInfo.personality.slice(0, 4).map((trait, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {trait}
                    </Badge>
                  ))}
                  {characterKnowledge.knowledgeGraph.basicInfo.personality.length > 4 && (
                    <Badge variant="outline" className="text-xs">
                      +{characterKnowledge.knowledgeGraph.basicInfo.personality.length - 4} more
                    </Badge>
                  )}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-purple-900 mb-2">Knowledge Base</h4>
                <div className="space-y-1 text-sm">
                  <p><strong>Chunks:</strong> {characterKnowledge.chunks.length}</p>
                  <p><strong>Total Tokens:</strong> {characterKnowledge.chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)}</p>
                  <p><strong>Created:</strong> {new Date(characterKnowledge.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
            
            {characterKnowledge.knowledgeGraph.attributes.catchphrases.length > 0 && (
              <div>
                <h4 className="font-medium text-purple-900 mb-2">Catchphrases</h4>
                <div className="flex flex-wrap gap-2">
                  {characterKnowledge.knowledgeGraph.attributes.catchphrases.slice(0, 3).map((phrase, index) => (
                    <Badge key={index} variant="outline" className="text-xs italic">
                      "{phrase}"
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error/Success Messages */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-700">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="mb-3 w-1/3 h-6" />
                <Skeleton className="mb-2 w-full h-4" />
                <Skeleton className="w-2/3 h-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Roleplays List */}
      {!isLoading && (
        <div className="space-y-4">
          {roleplays.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Theater className="mx-auto mb-4 w-12 h-12 opacity-50 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium text-muted-foreground">No Roleplays Found</h3>
                <p className="mb-4 text-muted-foreground">Create your first roleplay to get started</p>
                <Button onClick={openCreateDialog}>
                  <Plus className="mr-2 w-4 h-4" />
                  Create Roleplay
                </Button>
              </CardContent>
            </Card>
          ) : (
            roleplays.map((roleplay) => (
              <Card key={roleplay.id} className={`transition-all ${roleplay.isActive ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex gap-3 items-center mb-2">
                        <h3 className="text-lg font-semibold">{roleplay.name}</h3>
                        {roleplay.isActive && (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            <Play className="mr-1 w-3 h-3" />
                            Active
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {new Date(roleplay.createdAt).toLocaleDateString()}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mb-3">{roleplay.description}</p>
                      
                      <div className="flex gap-2 items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleCharacterDetails(roleplay.id)}
                        >
                          {showCharacterDetails === roleplay.id ? (
                            <>
                              <EyeOff className="mr-1 w-3 h-3" />
                              Hide Details
                            </>
                          ) : (
                            <>
                              <Eye className="mr-1 w-3 h-3" />
                              View Details
                            </>
                          )}
                        </Button>
                        
                        <Badge variant="secondary" className="text-xs">
                          {countWords(roleplay.systemPrompt)} words
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(roleplay)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      
                      {!roleplay.isActive ? (
                        <Button
                          size="sm"
                          onClick={() => handleActivateRoleplay(roleplay.id)}
                        >
                          <Play className="mr-1 w-4 h-4" />
                          Activate
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleActivateRoleplay(roleplay.id)}
                        >
                          <Pause className="mr-1 w-4 h-4" />
                          Deactivate
                        </Button>
                      )}
                      
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteRoleplay(roleplay.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {showCharacterDetails === roleplay.id && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium mb-2">System Prompt</h4>
                      <div className="p-4 bg-muted rounded-lg">
                        <ScrollArea className="max-h-48">
                          <p className="text-sm whitespace-pre-wrap">{roleplay.systemPrompt}</p>
                        </ScrollArea>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
