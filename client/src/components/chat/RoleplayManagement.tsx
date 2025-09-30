import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Skeleton } from "../ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  Save,
  Play,
  Pause,
  Theater,
  Sparkles,
  CheckCircle2,
  XCircle,
  Brain,
  Search,
  Globe,
} from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Roleplay } from "../../types/chat";

interface RoleplayManagementProps {
  conversationId: string | null;
}

export function RoleplayManagement({
  conversationId,
}: RoleplayManagementProps) {
  const [roleplays, setRoleplays] = useState<Roleplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoleplay, setEditingRoleplay] = useState<Roleplay | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [roleplayType, setRoleplayType] = useState<"generic" | "character">(
    "generic"
  );

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    isActive: false,
    characterName: "",
    characterSource: "",
  });

  // Helper function to count words
  const countWords = (text: string): number => {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  };

  // Check if enhancement can be enabled
  const canEnhance =
    formData.name.trim() !== "" && formData.description.trim() !== "";
  const canResearch =
    roleplayType === "character" && formData.characterName.trim() !== "";

  useEffect(() => {
    if (conversationId) {
      loadRoleplays();
    }
  }, [conversationId]);

  useEffect(() => {
    if (successMessage || error) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
        setError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, error]);

  const loadRoleplays = async () => {
    if (!conversationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await ChatApiService.getRoleplays(conversationId);
      if (response.success) {
        setRoleplays(response.data.roleplays);
      } else {
        setError("Failed to load roleplays");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roleplays");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingRoleplay(null);
    setRoleplayType("generic");
    setFormData({
      name: "",
      description: "",
      systemPrompt: "",
      isActive: false,
      characterName: "",
      characterSource: "",
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (roleplay: Roleplay) => {
    setEditingRoleplay(roleplay);
    setRoleplayType("generic"); // Editing only for generic for now
    setFormData({
      name: roleplay.name,
      description: roleplay.description || "",
      systemPrompt: roleplay.systemPrompt || "",
      isActive: roleplay.isActive,
      characterName: "",
      characterSource: "",
    });
    setIsDialogOpen(true);
  };

  const handleResearchCharacter = async () => {
    if (!conversationId || !canResearch) return;

    setIsResearching(true);
    setError(null);

    try {
      // Call the character research API
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

        // Populate form with character data
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

        // Close dialog and reload roleplays
        setTimeout(() => {
          setIsDialogOpen(false);
          loadRoleplays();
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

  const handleSaveRoleplay = async () => {
    if (!conversationId || !formData.name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      let response;
      if (editingRoleplay) {
        response = await ChatApiService.updateRoleplay(
          conversationId,
          editingRoleplay.id,
          formData
        );
      } else {
        response = await ChatApiService.createRoleplay(conversationId, {
          name: formData.name,
          description: formData.description,
          systemPrompt: formData.systemPrompt,
          isActive: formData.isActive,
        });
      }

      if (response.success) {
        setSuccessMessage(
          editingRoleplay
            ? "Roleplay updated successfully"
            : "Roleplay created successfully"
        );
        setIsDialogOpen(false);
        await loadRoleplays();
      } else {
        setError("Failed to save roleplay");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save roleplay");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnhanceRoleplay = async () => {
    if (!conversationId || !canEnhance) return;

    setIsEnhancing(true);
    setError(null);

    try {
      const response = await ChatApiService.enhanceRoleplayPreview(
        conversationId,
        {
          name: formData.name,
          description: formData.description,
        }
      );

      if (response.success) {
        const enhancedPrompt = response.data.enhancedSystemPrompt;

        // Limit to 250 words
        const words = enhancedPrompt.trim().split(/\s+/);
        const limitedPrompt = words.slice(0, 250).join(" ");

        setFormData({
          ...formData,
          systemPrompt: limitedPrompt,
        });

        setSuccessMessage("System prompt enhanced successfully!");
      } else {
        setError("Failed to enhance roleplay. Please try again.");
      }
    } catch (error) {
      setError("Failed to enhance roleplay. Please try again.");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleToggleActive = async (roleplay: Roleplay) => {
    if (!conversationId) return;

    try {
      const response = await ChatApiService.updateRoleplay(
        conversationId,
        roleplay.id,
        { isActive: !roleplay.isActive }
      );

      if (response.success) {
        setSuccessMessage(
          `Roleplay ${roleplay.isActive ? "deactivated" : "activated"}`
        );
        await loadRoleplays();
      } else {
        setError("Failed to toggle roleplay status");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to toggle roleplay status"
      );
    }
  };

  const handleDeleteRoleplay = async (roleplayId: string) => {
    if (
      !conversationId ||
      !confirm("Are you sure you want to delete this roleplay?")
    )
      return;

    try {
      const response = await ChatApiService.deleteRoleplay(
        conversationId,
        roleplayId
      );
      if (response.success) {
        setSuccessMessage("Roleplay deleted successfully");
        await loadRoleplays();
      } else {
        setError("Failed to delete roleplay");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete roleplay"
      );
    }
  };

  if (!conversationId) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-muted-foreground">
          <Theater className="mx-auto mb-2 w-8 h-8 opacity-50" />
          <p>Select a conversation to manage roleplays</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2 items-center">
          <Theater className="w-4 h-4" />
          <h3 className="font-medium">Roleplays</h3>
          <Badge variant="secondary" className="text-xs">
            {roleplays.length}
          </Badge>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="mr-1 w-3 h-3" />
              Add Roleplay
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingRoleplay ? "Edit Roleplay" : "Create New Roleplay"}
              </DialogTitle>
              <DialogDescription>
                {editingRoleplay
                  ? "Update the roleplay configuration."
                  : "Create a roleplay - choose a specific character or generic role."}
              </DialogDescription>
            </DialogHeader>

            {!editingRoleplay && (
              <Tabs
                value={roleplayType}
                onValueChange={(value) =>
                  setRoleplayType(value as "generic" | "character")
                }
              >
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="generic">
                    <Sparkles className="mr-2 w-4 h-4" />
                    Generic Role
                  </TabsTrigger>
                  <TabsTrigger value="character">
                    <Brain className="mr-2 w-4 h-4" />
                    Specific Character
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="generic" className="mt-4 space-y-4">
                  {/* <Alert>
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      Create a generic roleplay persona (e.g., "Helpful
                      Assistant", "Creative Writer")
                    </AlertDescription>
                  </Alert> */}
                  <div>
                    <Label htmlFor="name">Role Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="e.g., Helpful Assistant, Creative Writer"
                    />
                  </div>
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Brief description of the roleplay"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <Label htmlFor="systemPrompt">System Prompt</Label>
                      <div className="flex gap-2 items-center">
                        <span
                          className={`text-xs ${
                            countWords(formData.systemPrompt) > 250
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {countWords(formData.systemPrompt)}/250 words
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleEnhanceRoleplay}
                          disabled={!canEnhance || isEnhancing}
                          className="text-xs"
                        >
                          {isEnhancing ? (
                            <>
                              <div className="mr-1 w-3 h-3 rounded-full border-2 border-current animate-spin border-t-transparent" />
                              Enhancing...
                            </>
                          ) : (
                            <>
                              <Sparkles className="mr-1 w-3 h-3" />
                              Enhance with AI
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      id="systemPrompt"
                      value={formData.systemPrompt}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          systemPrompt: e.target.value,
                        })
                      }
                      placeholder="Detailed instructions for the AI to follow this role..."
                      rows={6}
                    />
                    {countWords(formData.systemPrompt) > 250 && (
                      <p className="mt-1 text-xs text-red-500">
                        System prompt exceeds 250 word limit. Please shorten it.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="character" className="mt-4 space-y-4">
                  <Alert className="bg-purple-50 border-purple-200">
                    <Brain className="w-4 h-4 text-purple-600" />
                    <AlertDescription className="text-purple-900">
                      <strong>Character Research System</strong>
                      <br />
                      Enter any character name (real or fictional). The system
                      will automatically research them, build a knowledge graph,
                      and create an authentic roleplay.
                    </AlertDescription>
                  </Alert>

                  <div>
                    <Label htmlFor="characterName">
                      Character Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="characterName"
                      value={formData.characterName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          characterName: e.target.value,
                        })
                      }
                      placeholder="e.g., Albert Einstein, Sherlock Holmes, Donna Paulsen"
                    />
                  </div>

                  <div>
                    <Label htmlFor="characterSource">
                      Source (optional but recommended)
                    </Label>
                    <Input
                      id="characterSource"
                      value={formData.characterSource}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          characterSource: e.target.value,
                        })
                      }
                      placeholder="e.g., Suits, BBC Sherlock, Naruto, Real Person"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Helps disambiguate characters with same name
                    </p>
                  </div>

                  <Button
                    onClick={handleResearchCharacter}
                    disabled={!canResearch || isResearching}
                    className="w-full"
                    size="lg"
                  >
                    {isResearching ? (
                      <>
                        <div className="mr-2 w-4 h-4 rounded-full border-2 border-current animate-spin border-t-transparent" />
                        Researching Character (10-15s)...
                      </>
                    ) : (
                      <>
                        <Globe className="mr-2 w-4 h-4" />
                        <Search className="mr-2 w-4 h-4" />
                        Research & Create Character
                      </>
                    )}
                  </Button>

                  {formData.systemPrompt && (
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex gap-2 items-center mb-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-green-900">
                          Character Research Complete!
                        </span>
                      </div>
                      <div className="p-2 text-xs text-green-800 bg-white rounded">
                        <strong>Generated System Prompt:</strong>
                        <div className="overflow-y-auto mt-1 max-h-32">
                          {formData.systemPrompt}
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {editingRoleplay && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Role Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., Helpful Assistant, Creative Writer"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Brief description of the roleplay"
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label htmlFor="systemPrompt">System Prompt</Label>
                    <span
                      className={`text-xs ${
                        countWords(formData.systemPrompt) > 250
                          ? "text-red-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {countWords(formData.systemPrompt)}/250 words
                    </span>
                  </div>
                  <Textarea
                    id="systemPrompt"
                    value={formData.systemPrompt}
                    onChange={(e) =>
                      setFormData({ ...formData, systemPrompt: e.target.value })
                    }
                    placeholder="Detailed instructions for the AI to follow this role..."
                    rows={6}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) =>
                  setFormData({ ...formData, isActive: e.target.checked })
                }
                className="rounded"
              />
              <Label htmlFor="isActive">Set as active roleplay</Label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              {roleplayType === "generic" && (
                <Button onClick={handleSaveRoleplay} disabled={isLoading}>
                  <Save className="mr-1 w-3 h-3" />
                  {editingRoleplay ? "Update" : "Create"} Roleplay
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="mb-2 w-1/3 h-4" />
                <Skeleton className="mb-2 w-full h-3" />
                <Skeleton className="w-2/3 h-3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Roleplays List */}
      {!isLoading && (
        <ScrollArea className="h-[calc(100vh-300px)]">
          {roleplays.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Theater className="mx-auto mb-2 w-8 h-8 opacity-50" />
              <p>No roleplays found</p>
              <p className="text-sm">Create a roleplay to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {roleplays.map((roleplay) => (
                <Card
                  key={roleplay.id}
                  className="transition-shadow group hover:shadow-md"
                >
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div className="flex flex-1 gap-2 items-center min-w-0">
                        <CardTitle className="text-sm truncate">
                          {roleplay.name}
                        </CardTitle>
                        <Badge
                          variant={roleplay.isActive ? "default" : "secondary"}
                          className="text-xs shrink-0"
                        >
                          {roleplay.isActive ? (
                            <>
                              <CheckCircle2 className="mr-1 w-3 h-3" />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle className="mr-1 w-3 h-3" />
                              Inactive
                            </>
                          )}
                        </Badge>
                      </div>
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleActive(roleplay)}
                          title={roleplay.isActive ? "Deactivate" : "Activate"}
                          className="p-0 w-7 h-7"
                        >
                          {roleplay.isActive ? (
                            <Pause className="w-3 h-3" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(roleplay)}
                          title="Edit"
                          className="p-0 w-7 h-7"
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRoleplay(roleplay.id)}
                          title="Delete"
                          className="p-0 w-7 h-7 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {roleplay.description && (
                      <p className="mb-2 text-sm text-muted-foreground line-clamp-2">
                        {roleplay.description}
                      </p>
                    )}
                    {roleplay.systemPrompt && (
                      <div className="p-2 text-xs rounded bg-muted/50">
                        <p className="text-muted-foreground line-clamp-3">
                          {roleplay.systemPrompt}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
