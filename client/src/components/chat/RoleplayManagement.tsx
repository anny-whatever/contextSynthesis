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
  Theater,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Save,
  Edit,
  Trash2,
  Play,
  Pause,
  User,
  BookOpen,
  Eye,
  EyeOff,
  Search,
  Wand2,
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [characterKnowledge, setCharacterKnowledge] = useState<any>(null);
  const [showCharacterDetails, setShowCharacterDetails] = useState<Record<string, boolean>>({});
  
  // Creation mode state
  const [creationMode, setCreationMode] = useState<'general' | 'character'>('general');
  const [isResearching, setIsResearching] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    isActive: false,
    // Character research fields
    characterName: "",
    characterSource: "",
  });

  // Load roleplays and character knowledge
  useEffect(() => {
    if (conversationId) {
      loadRoleplays();
      loadCharacterKnowledge();
    }
  }, [conversationId]);

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
      setError("Error loading roleplays");
      console.error("Error loading roleplays:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCharacterKnowledge = async () => {
    if (!conversationId) return;
    
    try {
      const response = await ChatApiService.getCharacterKnowledge(conversationId);
      if (response.success) {
        setCharacterKnowledge(response.data);
      }
    } catch (err) {
      console.error("Error loading character knowledge:", err);
    }
  };

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      systemPrompt: "",
      isActive: false,
      characterName: "",
      characterSource: "",
    });
    setEditingRoleplay(null);
    setCreationMode('general');
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
    clearMessages();
  };

  const openEditDialog = (roleplay: Roleplay) => {
    setFormData({
      name: roleplay.name,
      description: roleplay.description,
      systemPrompt: roleplay.systemPrompt,
      isActive: roleplay.isActive,
      characterName: "",
      characterSource: "",
    });
    setEditingRoleplay(roleplay);
    setCreationMode('general');
    setIsDialogOpen(true);
    clearMessages();
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
        setSuccessMessage(`Character research completed for ${formData.characterName}`);
        
        // Auto-populate roleplay fields with research data
        if (response.data) {
          setFormData(prev => ({
            ...prev,
            name: `${formData.characterName} Roleplay`,
            description: `Roleplay as ${formData.characterName}${formData.characterSource ? ` from ${formData.characterSource}` : ''}`,
            systemPrompt: response.data.systemPrompt || `You are ${formData.characterName}. Roleplay as this character based on the researched knowledge.`,
          }));
        }
        
        // Reload character knowledge to show updated data
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

  const handleSubmit = async () => {
    if (!conversationId) return;
    
    if (!formData.name.trim() || !formData.description.trim() || !formData.systemPrompt.trim()) {
      setError("Name, description, and system prompt are required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (editingRoleplay) {
        const response = await ChatApiService.updateRoleplay(
          conversationId,
          editingRoleplay.id,
          {
            name: formData.name,
            description: formData.description,
            systemPrompt: formData.systemPrompt,
            isActive: formData.isActive,
          }
        );

        if (response.success) {
          setSuccessMessage("Roleplay updated successfully");
          setIsDialogOpen(false);
          resetForm();
          loadRoleplays();
        } else {
          setError("Failed to update roleplay");
        }
      } else {
        const response = await ChatApiService.createRoleplay(conversationId, {
          name: formData.name,
          description: formData.description,
          systemPrompt: formData.systemPrompt,
          isActive: formData.isActive,
        });

        if (response.success) {
          setSuccessMessage("Roleplay created successfully");
          setIsDialogOpen(false);
          resetForm();
          loadRoleplays();
        } else {
          setError("Failed to create roleplay");
        }
      }
    } catch (err) {
      setError(editingRoleplay ? "Error updating roleplay" : "Error creating roleplay");
      console.error("Error submitting roleplay:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivateRoleplay = async (roleplay: Roleplay) => {
    if (!conversationId) return;
    
    try {
      const response = await ChatApiService.updateRoleplay(
        conversationId,
        roleplay.id,
        { isActive: !roleplay.isActive }
      );

      if (response.success) {
        setSuccessMessage(
          `Roleplay ${roleplay.isActive ? "deactivated" : "activated"} successfully`
        );
        loadRoleplays();
      } else {
        setError("Failed to update roleplay status");
      }
    } catch (err) {
      setError("Error updating roleplay status");
      console.error("Error updating roleplay status:", err);
    }
  };

  const handleDeleteRoleplay = async (roleplay: Roleplay) => {
    if (!conversationId) return;
    
    if (!confirm(`Are you sure you want to delete "${roleplay.name}"?`)) {
      return;
    }

    try {
      const response = await ChatApiService.deleteRoleplay(conversationId, roleplay.id);

      if (response.success) {
        setSuccessMessage("Roleplay deleted successfully");
        loadRoleplays();
      } else {
        setError("Failed to delete roleplay");
      }
    } catch (err) {
      setError("Error deleting roleplay");
      console.error("Error deleting roleplay:", err);
    }
  };

  const toggleCharacterDetails = (roleplayId: string) => {
    setShowCharacterDetails(prev => ({
      ...prev,
      [roleplayId]: !prev[roleplayId]
    }));
  };

  const countWords = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
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
    <div className="flex flex-col h-full">
      {/* Header Section */}
      <div className="flex-shrink-0 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-b dark:from-blue-950/20 dark:to-indigo-950/20">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Roleplay Management
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Create and manage AI roleplay characters with full-width control
            </p>
          </div>
          <Button
            onClick={openCreateDialog}
            className="text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg hover:from-blue-700 hover:to-indigo-700"
          >
            <Plus className="mr-2 w-4 h-4" />
            Create Roleplay
          </Button>
        </div>

        {/* Messages */}
        {successMessage && (
          <Alert className="mb-4 bg-green-50 border-green-200 dark:bg-green-950/20">
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

      {/* Content Section */}
      <div className="flex-1 p-6 overflow-auto">
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
                  <h3 className="mb-2 text-lg font-medium text-muted-foreground">
                    No roleplays created yet
                  </h3>
                  <p className="mb-4 text-muted-foreground">
                    Create your first roleplay to get started with character interactions
                  </p>
                  <Button onClick={openCreateDialog}>
                    <Plus className="mr-2 w-4 h-4" />
                    Create Roleplay
                  </Button>
                </CardContent>
              </Card>
            ) : (
              roleplays.map((roleplay) => (
                <Card
                  key={roleplay.id}
                  className={`transition-all ${
                    roleplay.isActive ? "ring-2 ring-primary bg-primary/5" : ""
                  }`}
                >
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">{roleplay.name}</h3>
                          {roleplay.isActive && (
                            <Badge variant="default" className="bg-green-100 text-green-800">
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground mb-3">{roleplay.description}</p>
                        
                        {/* Character Knowledge Display */}
                        {characterKnowledge && showCharacterDetails[roleplay.id] && (
                          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                            <h4 className="font-medium mb-2 flex items-center gap-2">
                              <User className="w-4 h-4" />
                              Character Knowledge
                            </h4>
                            <div className="space-y-2 text-sm">
                              <div>
                                <span className="font-medium">Basic Info:</span>{" "}
                                {characterKnowledge.knowledgeGraph?.basicInfo 
                                  ? Object.entries(characterKnowledge.knowledgeGraph.basicInfo)
                                      .map(([key, value]) => `${key}: ${value}`)
                                      .join(", ")
                                  : "No basic info available"}
                              </div>
                              <div>
                                <span className="font-medium">Traits:</span>{" "}
                                {characterKnowledge.knowledgeGraph?.attributes?.catchphrases || 
                                 characterKnowledge.knowledgeGraph?.attributes?.communication ||
                                 "No traits available"}
                              </div>
                              <div>
                                <span className="font-medium">Backstory:</span>{" "}
                                {characterKnowledge.knowledgeGraph?.attributes?.backstory || "No backstory available"}
                              </div>
                              <div>
                                <span className="font-medium">Knowledge Base:</span>{" "}
                                {characterKnowledge.chunks?.length || 0} chunks
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2 ml-4">
                        {characterKnowledge && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleCharacterDetails(roleplay.id)}
                          >
                            {showCharacterDetails[roleplay.id] ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(roleplay)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleActivateRoleplay(roleplay)}
                        >
                          {roleplay.isActive ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteRoleplay(roleplay)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* System Prompt Preview */}
                    <div className="mt-4 p-3 bg-muted/30 rounded text-sm">
                      <span className="font-medium">System Prompt:</span>
                      <p className="mt-1 text-muted-foreground line-clamp-2">
                        {roleplay.systemPrompt}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRoleplay ? "Edit Roleplay" : "Create Roleplay"}
            </DialogTitle>
            <DialogDescription>
              {editingRoleplay 
                ? "Update your roleplay character settings"
                : "Create a new roleplay character with general settings or research a specific character"
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Creation Mode Tabs (only for new roleplays) */}
            {!editingRoleplay && (
              <Tabs value={creationMode} onValueChange={(value) => setCreationMode(value as 'general' | 'character')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="general" className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    General Roleplay
                  </TabsTrigger>
                  <TabsTrigger value="character" className="flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Character Research
                  </TabsTrigger>
                </TabsList>

                {/* General Roleplay Tab Content */}
                <TabsContent value="general" className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 rounded-lg">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Manual Roleplay Creation
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Create a custom roleplay character by manually defining their personality, behavior, and system prompt.
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">Roleplay Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter roleplay name"
                      />
                    </div>

                    <div>
                      <Label htmlFor="description">Description *</Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Describe the roleplay character and scenario"
                        rows={3}
                      />
                    </div>

                    <div>
                      <Label htmlFor="systemPrompt">System Prompt *</Label>
                      <Textarea
                        id="systemPrompt"
                        value={formData.systemPrompt}
                        onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                        placeholder="Enter the system prompt that defines the character's behavior"
                        rows={6}
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isActive"
                        checked={formData.isActive}
                        onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                        className="rounded"
                      />
                      <Label htmlFor="isActive">Activate this roleplay immediately</Label>
                    </div>
                  </div>
                </TabsContent>

                {/* Character Research Tab Content */}
                <TabsContent value="character" className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-lg">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <Wand2 className="w-4 h-4" />
                      Character Research
                    </h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      Research a specific character to automatically generate roleplay settings based on their knowledge.
                    </p>
                    
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="characterName">Character Name *</Label>
                        <Input
                          id="characterName"
                          value={formData.characterName}
                          onChange={(e) => setFormData(prev => ({ ...prev, characterName: e.target.value }))}
                          placeholder="e.g., Sherlock Holmes, Harry Potter"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="characterSource">Source (Optional)</Label>
                        <Input
                          id="characterSource"
                          value={formData.characterSource}
                          onChange={(e) => setFormData(prev => ({ ...prev, characterSource: e.target.value }))}
                          placeholder="e.g., BBC Sherlock, Harry Potter series"
                        />
                      </div>
                      
                      <Button
                        onClick={handleResearchCharacter}
                        disabled={isResearching || !formData.characterName.trim()}
                        className="w-full"
                      >
                        {isResearching ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                            Researching Character...
                          </>
                        ) : (
                          <>
                            <Search className="w-4 h-4 mr-2" />
                            Research Character
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Show roleplay fields only after research or if manually filled */}
                  {(formData.name || formData.description || formData.systemPrompt) && (
                    <div className="space-y-4 pt-4 border-t">
                      <h5 className="font-medium text-sm text-muted-foreground">Generated Roleplay Settings</h5>
                      
                      <div>
                        <Label htmlFor="name-research">Roleplay Name *</Label>
                        <Input
                          id="name-research"
                          value={formData.name}
                          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Enter roleplay name"
                        />
                      </div>

                      <div>
                        <Label htmlFor="description-research">Description *</Label>
                        <Textarea
                          id="description-research"
                          value={formData.description}
                          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Describe the roleplay character and scenario"
                          rows={3}
                        />
                      </div>

                      <div>
                        <Label htmlFor="systemPrompt-research">System Prompt *</Label>
                        <Textarea
                          id="systemPrompt-research"
                          value={formData.systemPrompt}
                          onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                          placeholder="Enter the system prompt that defines the character's behavior"
                          rows={6}
                        />
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="isActive-research"
                          checked={formData.isActive}
                          onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                          className="rounded"
                        />
                        <Label htmlFor="isActive-research">Activate this roleplay immediately</Label>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {/* Edit Mode - Show form fields directly */}
            {editingRoleplay && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name-edit">Roleplay Name *</Label>
                  <Input
                    id="name-edit"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter roleplay name"
                  />
                </div>

                <div>
                  <Label htmlFor="description-edit">Description *</Label>
                  <Textarea
                    id="description-edit"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe the roleplay character and scenario"
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="systemPrompt-edit">System Prompt *</Label>
                  <Textarea
                    id="systemPrompt-edit"
                    value={formData.systemPrompt}
                    onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    placeholder="Enter the system prompt that defines the character's behavior"
                    rows={6}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isActive-edit"
                    checked={formData.isActive}
                    onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="rounded"
                  />
                  <Label htmlFor="isActive-edit">Activate this roleplay immediately</Label>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !formData.name.trim() || !formData.description.trim() || !formData.systemPrompt.trim()}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  {editingRoleplay ? "Updating..." : "Creating..."}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {editingRoleplay ? "Update Roleplay" : "Create Roleplay"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
