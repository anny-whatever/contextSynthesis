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
} from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Roleplay } from "../../types/chat";

interface RoleplayManagementProps {
  conversationId: string | null;
}

export function RoleplayManagement({ conversationId }: RoleplayManagementProps) {
  const [roleplays, setRoleplays] = useState<Roleplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoleplay, setEditingRoleplay] = useState<Roleplay | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    isActive: false,
  });

  // Helper function to count words
  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  // Check if enhancement can be enabled
  const canEnhance = formData.name.trim() !== "" && formData.description.trim() !== "";

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
    setFormData({
      name: "",
      description: "",
      systemPrompt: "",
      isActive: false,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (roleplay: Roleplay) => {
    setEditingRoleplay(roleplay);
    setFormData({
      name: roleplay.name,
      description: roleplay.description || "",
      systemPrompt: roleplay.systemPrompt || "",
      isActive: roleplay.isActive,
    });
    setIsDialogOpen(true);
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
          editingRoleplay ? "Roleplay updated successfully" : "Roleplay created successfully"
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
      const response = await ChatApiService.enhanceRoleplayPreview(conversationId, {
        name: formData.name,
        description: formData.description,
      });

      if (response.success) {
        const enhancedPrompt = response.data.enhancedSystemPrompt;
        
        // Limit to 250 words
        const words = enhancedPrompt.trim().split(/\s+/);
        const limitedPrompt = words.slice(0, 250).join(' ');
        
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
    if (!conversationId || !confirm("Are you sure you want to delete this roleplay?")) return;

    try {
      const response = await ChatApiService.deleteRoleplay(conversationId, roleplayId);
      if (response.success) {
        setSuccessMessage("Roleplay deleted successfully");
        await loadRoleplays();
      } else {
        setError("Failed to delete roleplay");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete roleplay");
    }
  };

  if (!conversationId) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-muted-foreground">
          <Theater className="w-8 h-8 mx-auto mb-2 opacity-50" />
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
              <Plus className="w-3 h-3 mr-1" />
              Add Roleplay
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingRoleplay ? "Edit Roleplay" : "Create New Roleplay"}
              </DialogTitle>
              <DialogDescription>
                {editingRoleplay
                  ? "Update the roleplay configuration and enhance it with AI."
                  : "Create a new roleplay scenario for the AI to follow."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
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
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${countWords(formData.systemPrompt) > 250 ? 'text-red-500' : 'text-muted-foreground'}`}>
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
                          <div className="w-3 h-3 mr-1 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          Enhancing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3 mr-1" />
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
                    setFormData({ ...formData, systemPrompt: e.target.value })
                  }
                  placeholder="Detailed instructions for the AI to follow this role..."
                  rows={6}
                />
                {countWords(formData.systemPrompt) > 250 && (
                  <p className="text-xs text-red-500 mt-1">
                    System prompt exceeds 250 word limit. Please shorten it.
                  </p>
                )}
              </div>
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveRoleplay} disabled={isLoading}>
                <Save className="w-3 h-3 mr-1" />
                {editingRoleplay ? "Update" : "Create"} Roleplay
              </Button>
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
        <Alert className="border-green-200 bg-green-50">
          <AlertCircle className="w-4 h-4 text-green-600" />
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
              <Theater className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No roleplays found</p>
              <p className="text-sm">Create a roleplay to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {roleplays.map((roleplay) => (
                <Card key={roleplay.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-2 items-center min-w-0 flex-1">
                        <CardTitle className="text-sm truncate">{roleplay.name}</CardTitle>
                        <Badge
                          variant={roleplay.isActive ? "default" : "secondary"}
                          className="text-xs shrink-0"
                        >
                          {roleplay.isActive ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 mr-1" />
                              Inactive
                            </>
                          )}
                        </Badge>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleActive(roleplay)}
                          title={roleplay.isActive ? "Deactivate" : "Activate"}
                          className="h-7 w-7 p-0"
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
                          className="h-7 w-7 p-0"
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRoleplay(roleplay.id)}
                          title="Delete"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {roleplay.description && (
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {roleplay.description}
                      </p>
                    )}
                    {roleplay.systemPrompt && (
                      <div className="p-2 bg-muted/50 rounded text-xs">
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