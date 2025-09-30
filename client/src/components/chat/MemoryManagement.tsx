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
  X,
  Database,
  Key,
  Calendar,
  TrendingUp,
  Users,
  MapPin,
  Calendar as CalendarIcon,
  Heart,
  Package,
  Filter,
  Grid3X3,
  List,
} from "lucide-react";
import { ChatApiService } from "../../services/chatApi";
import type { Memory } from "../../types/chat";

interface MemoryManagementProps {
  conversationId: string | null;
}

export function MemoryManagement({ conversationId }: MemoryManagementProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [newKeyValuePairs, setNewKeyValuePairs] = useState("{}");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Predefined categories with icons and colors
  const categories = {
    people: { icon: Users, label: "People", color: "bg-blue-50 text-blue-700 border-blue-200" },
    places: { icon: MapPin, label: "Places", color: "bg-green-50 text-green-700 border-green-200" },
    events: { icon: CalendarIcon, label: "Events", color: "bg-purple-50 text-purple-700 border-purple-200" },
    life_events: { icon: Heart, label: "Life Events", color: "bg-pink-50 text-pink-700 border-pink-200" },
    things: { icon: Package, label: "Things", color: "bg-orange-50 text-orange-700 border-orange-200" },
  };

  // Load memories when conversation changes
  useEffect(() => {
    if (conversationId) {
      loadMemories();
    } else {
      setMemories([]);
    }
  }, [conversationId]);

  const loadMemories = async () => {
    if (!conversationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await ChatApiService.getMemories(conversationId);
      if (response.success) {
        setMemories(response.data.memories);
      } else {
        setError("Failed to load memories");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveMemory = async () => {
    if (!conversationId || !newCategory.trim()) return;

    try {
      const keyValuePairs = JSON.parse(newKeyValuePairs);
      const response = await ChatApiService.updateMemory(
        conversationId,
        newCategory.trim(),
        keyValuePairs
      );

      if (response.success) {
        setSuccessMessage(response.data.message);
        setIsDialogOpen(false);
        setNewCategory("");
        setNewKeyValuePairs("{}");
        setEditingMemory(null);
        await loadMemories();
      } else {
        setError("Failed to save memory");
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("Invalid JSON format in key-value pairs");
      } else {
        setError(err instanceof Error ? err.message : "Failed to save memory");
      }
    }
  };

  const handleDeleteMemoryKey = async (category: string, key: string) => {
    if (!conversationId) return;

    try {
      const response = await ChatApiService.deleteMemory(
        conversationId,
        category,
        key
      );

      if (response.success) {
        setSuccessMessage(response.message);
        await loadMemories();
      } else {
        setError("Failed to delete memory key");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete memory key"
      );
    }
  };

  const openEditDialog = (memory: Memory) => {
    setEditingMemory(memory);
    setNewCategory(memory.category);
    setNewKeyValuePairs(JSON.stringify(memory.keyValuePairs, null, 2));
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingMemory(null);
    setNewCategory("");
    setNewKeyValuePairs("{}");
    setIsDialogOpen(true);
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return "bg-green-50 text-green-700 border-green-200";
    if (score >= 0.6) return "bg-yellow-50 text-yellow-700 border-yellow-200";
    return "bg-red-50 text-red-700 border-red-200";
  };

  const getCategoryInfo = (category: string) => {
    return categories[category as keyof typeof categories] || {
      icon: Database,
      label: category.charAt(0).toUpperCase() + category.slice(1),
      color: "bg-gray-50 text-gray-700 border-gray-200"
    };
  };

  const filteredMemories = memories.filter(memory => 
    categoryFilter === "all" || memory.category === categoryFilter
  );

  const memoriesByCategory = filteredMemories.reduce((acc, memory) => {
    if (!acc[memory.category]) {
      acc[memory.category] = [];
    }
    acc[memory.category].push(memory);
    return acc;
  }, {} as Record<string, Memory[]>);

  if (!conversationId) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-muted-foreground">
          <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Select a conversation to manage memories</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2 items-center">
          <Database className="w-4 h-4" />
          <h3 className="font-medium">Memory Management</h3>
          {memories.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {filteredMemories.length} {filteredMemories.length === 1 ? 'memory' : 'memories'}
            </Badge>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {/* View Mode Toggle */}
          <div className="flex border rounded-md">
            <Button
              size="sm"
              variant={viewMode === "grid" ? "default" : "ghost"}
              onClick={() => setViewMode("grid")}
              className="h-8 px-2"
            >
              <Grid3X3 className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === "list" ? "default" : "ghost"}
              onClick={() => setViewMode("list")}
              className="h-8 px-2"
            >
              <List className="w-3 h-3" />
            </Button>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="w-3 h-3 mr-1" />
              Add Memory
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingMemory ? "Edit Memory" : "Add New Memory"}
              </DialogTitle>
              <DialogDescription>
                {editingMemory
                  ? "Update the memory category and key-value pairs."
                  : "Create a new memory with category and key-value pairs."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="e.g., preferences, facts, context"
                />
              </div>
              <div>
                <Label htmlFor="keyValuePairs">Key-Value Pairs (JSON)</Label>
                <Textarea
                  id="keyValuePairs"
                  value={newKeyValuePairs}
                  onChange={(e) => setNewKeyValuePairs(e.target.value)}
                  placeholder='{"key": "value", "another_key": "another_value"}'
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveMemory}>
                <Save className="w-3 h-3 mr-1" />
                Save Memory
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Category Filter */}
      {memories.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 items-center text-sm text-muted-foreground">
            <Filter className="w-3 h-3" />
            <span>Filter:</span>
          </div>
          <Button
            size="sm"
            variant={categoryFilter === "all" ? "default" : "outline"}
            onClick={() => setCategoryFilter("all")}
            className="h-7 text-xs"
          >
            All Categories
          </Button>
          {Object.entries(categories).map(([key, category]) => {
            const Icon = category.icon;
            const count = memories.filter(m => m.category === key).length;
            if (count === 0) return null;
            
            return (
              <Button
                key={key}
                size="sm"
                variant={categoryFilter === key ? "default" : "outline"}
                onClick={() => setCategoryFilter(key)}
                className="h-7 text-xs"
              >
                <Icon className="w-3 h-3 mr-1" />
                {category.label} ({count})
              </Button>
            );
          })}
        </div>
      )}

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
          {[...Array(3)].map((_, i) => (
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

      {/* Memories Display */}
      {!isLoading && (
        <ScrollArea className="h-[calc(100vh-350px)]">
          {filteredMemories.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>
                {memories.length === 0 
                  ? "No memories found for this conversation"
                  : `No memories found in ${categoryFilter === "all" ? "any" : getCategoryInfo(categoryFilter).label.toLowerCase()} category`
                }
              </p>
              <p className="text-sm">
                Add memories to help the AI remember important context
              </p>
            </div>
          ) : viewMode === "grid" ? (
            // Grid View - Organized by Categories
            <div className="space-y-6">
              {Object.entries(memoriesByCategory).map(([category, categoryMemories]) => {
                const categoryInfo = getCategoryInfo(category);
                const Icon = categoryInfo.icon;
                
                return (
                  <div key={category} className="space-y-3">
                    {/* Category Header */}
                    <div className="flex gap-2 items-center">
                      <div className={`p-2 rounded-md ${categoryInfo.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <h4 className="font-medium text-sm">{categoryInfo.label}</h4>
                      <Badge variant="secondary" className="text-xs">
                        {categoryMemories.length}
                      </Badge>
                    </div>
                    
                    {/* Category Memories Grid */}
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {categoryMemories.map((memory) => (
                        <Card key={memory.id} className="relative hover:shadow-md transition-shadow">
                          <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                              <Badge
                                variant="outline"
                                className={`text-xs ${getConfidenceColor(memory.confidenceScore)}`}
                              >
                                <TrendingUp className="w-3 h-3 mr-1" />
                                {(memory.confidenceScore * 100).toFixed(0)}%
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditDialog(memory)}
                                className="h-6 w-6 p-0"
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="space-y-2">
                              {/* Key-Value Pairs */}
                              <div className="space-y-1">
                                {Object.entries(memory.keyValuePairs).slice(0, 3).map(([key, value]) => (
                                  <div key={key} className="flex justify-between items-start text-xs">
                                    <span className="font-medium text-muted-foreground truncate">
                                      {key}:
                                    </span>
                                    <span className="text-right text-muted-foreground truncate max-w-[60%]">
                                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                    </span>
                                  </div>
                                ))}
                                {Object.keys(memory.keyValuePairs).length > 3 && (
                                  <div className="text-xs text-muted-foreground">
                                    +{Object.keys(memory.keyValuePairs).length - 3} more...
                                  </div>
                                )}
                              </div>
                              
                              {/* Metadata */}
                              <div className="text-xs text-muted-foreground pt-2 border-t">
                                <div className="flex gap-1 items-center">
                                  <Calendar className="w-3 h-3" />
                                  <span>Updated: {formatDate(memory.lastUpdated)}</span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // List View - Detailed View
            <div className="space-y-3">
              {filteredMemories.map((memory) => {
                const categoryInfo = getCategoryInfo(memory.category);
                const Icon = categoryInfo.icon;
                
                return (
                  <Card key={memory.id} className="relative">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div className="flex gap-2 items-center">
                          <div className={`p-1 rounded ${categoryInfo.color}`}>
                            <Icon className="w-3 h-3" />
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {categoryInfo.label}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-xs ${getConfidenceColor(memory.confidenceScore)}`}
                          >
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {(memory.confidenceScore * 100).toFixed(0)}%
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(memory)}
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-3">
                        {/* Key-Value Pairs */}
                        <div>
                          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                            Stored Information
                          </h4>
                          <div className="space-y-2">
                            {Object.entries(memory.keyValuePairs).map(([key, value]) => (
                              <div
                                key={key}
                                className="flex justify-between items-start p-2 bg-muted/50 rounded text-sm"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex gap-1 items-center mb-1">
                                    <Key className="w-3 h-3 text-muted-foreground" />
                                    <span className="font-medium text-xs">{key}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground break-words">
                                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="ml-2 h-6 w-6 p-0 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteMemoryKey(memory.category, key)}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Metadata */}
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <div className="flex gap-1 items-center">
                            <Calendar className="w-3 h-3" />
                            <span>Updated: {formatDate(memory.lastUpdated)}</span>
                          </div>
                          <div className="flex gap-1 items-center">
                            <Calendar className="w-3 h-3" />
                            <span>Created: {formatDate(memory.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}