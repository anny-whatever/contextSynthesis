import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Card } from "../ui/card";
import { Alert, AlertDescription } from "../ui/alert";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  AlertCircle,
  Plus,
  MessageSquare,
  Trash2,
  BarChart3,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TokenCounter } from "./CostCounter";
import { ContextSidebar } from "./ContextSidebar";
import { ChatApiService } from "../../services/chatApi";
import type {
  StreamingEvent,
  StreamingOptions,
} from "../../services/chatApi";
import { usePingMechanism } from "../../hooks/usePingMechanism";
import type { Message, Conversation } from "../../types/chat";

export function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingEvents, setStreamingEvents] = useState<StreamingEvent[]>([]);
  const [currentStreamMessage, setCurrentStreamMessage] = useState<string>("");
  const [useStreaming, setUseStreaming] = useState(true); // Toggle for streaming vs regular
  const [isModalOpen, setIsModalOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const userId = "anonymous";

  // Initialize pinging mechanism
  const pingMechanism = usePingMechanism({
    conversationId: conversation?.id || null,
    onUserMessage: () => {
      console.log("🔄 [PING] Started pinging after user message");
    },
    onAssistantMessage: () => {
      console.log(
        "🔄 [PING] Will stop pinging in 5 seconds after assistant message"
      );
    },
  });

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const createNewConversation = async () => {
    try {
      setError(null);
      setIsLoading(true);
      const response = await ChatApiService.createConversation(
        "New Chat",
        userId
      );
      setConversation(response.data);
      setMessages([]);
      loadUserConversations(); // Refresh the conversations list
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create conversation"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserConversations = async () => {
    try {
      setIsLoadingConversations(true);
      const response = await ChatApiService.getUserConversations(userId);
      setConversations(response.data.conversations);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load conversations"
      );
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const selectConversation = async (selectedConversation: Conversation) => {
    try {
      setError(null);
      setIsLoading(true);
      setConversation(selectedConversation);

      // Load messages for this conversation
      const response = await ChatApiService.getConversationMessages(
        selectedConversation.id
      );
      setMessages(response.data.messages); // Server already returns in correct order (oldest first)
      setIsModalOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load conversation"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const deleteConversation = async (
    conversationId: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent triggering selectConversation

    if (
      !confirm(
        "Are you sure you want to delete this conversation? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      setError(null);
      await ChatApiService.deleteConversation(conversationId);

      // If the deleted conversation is currently selected, clear it
      if (conversation?.id === conversationId) {
        setConversation(null);
        setMessages([]);
      }

      // Refresh the conversations list
      loadUserConversations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete conversation"
      );
    }
  };

  const handleSendMessage = async (messageContent: string) => {
    if (!conversation) {
      setError("No conversation available. Please start a new conversation.");
      return;
    }

    // Add user message immediately to UI
    const userMessage: Message = {
      role: "USER",
      content: messageContent,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setError(null);

    // Trigger pinging mechanism after user message
    pingMechanism.handleUserMessage();

    if (useStreaming) {
      // Use streaming API
      await handleSendMessageStreaming(messageContent);
    } else {
      // Use regular API
      await handleSendMessageRegular(messageContent);
    }
  };

  const handleSendMessageStreaming = async (messageContent: string) => {
    if (!conversation) return;

    setIsStreaming(true);
    setStreamingEvents([]);
    setCurrentStreamMessage("");

    // Create placeholder assistant message for streaming
    const assistantMessageId = Date.now().toString();
    const placeholderAssistantMessage: Message = {
      role: "ASSISTANT",
      content: "",
      timestamp: new Date(),
      toolUsages: [],
    };
    setMessages((prev) => [...prev, placeholderAssistantMessage]);

    const streamingOptions: StreamingOptions = {
      onEvent: (event: StreamingEvent) => {
        setStreamingEvents((prev) => [...prev, event]);

        // Handle different event types
        switch (event.type) {
          case "tool_start":
            console.log(`🔄 ${event.data.message || "Tool starting..."}`);
            break;
          case "tool_complete":
            console.log(`✅ ${event.data.message || "Tool completed"}`);
            break;
          case "message_chunk":
            setCurrentStreamMessage(
              (prev) => prev + (event.data.content || "")
            );
            // Update the placeholder message with streaming content
            setMessages((prevMessages) => {
              const updatedMessages = [...prevMessages];
              const lastMessage = updatedMessages[updatedMessages.length - 1];
              if (lastMessage && lastMessage.role === "ASSISTANT") {
                lastMessage.content =
                  currentStreamMessage + (event.data.content || "");
              }
              return updatedMessages;
            });
            break;
          case "connection":
            if (event.data.status === "connected") {
              console.log("🔗 Streaming connection established");
            }
            break;
        }
      },
      onComplete: (response) => {
        // Update final message with complete response
        setMessages((prevMessages) => {
          const updatedMessages = [...prevMessages];
          const lastMessage = updatedMessages[updatedMessages.length - 1];
          if (lastMessage && lastMessage.role === "ASSISTANT") {
            lastMessage.content = response.data.message;
            lastMessage.timestamp = new Date(response.data.timestamp);
            lastMessage.toolUsages = response.data.toolsUsed;
          }
          return updatedMessages;
        });

        setIsStreaming(false);
        setCurrentStreamMessage("");
        pingMechanism.handleAssistantMessage();
        console.log("✅ Streaming completed");
      },
      onError: (error) => {
        setError(error.message);
        setIsStreaming(false);
        setCurrentStreamMessage("");
        // Remove the placeholder message on error
        setMessages((prev) => prev.slice(0, -1));
        pingMechanism.stopPinging();
        console.error("❌ Streaming error:", error.message);
      },
    };

    // Start streaming
    const cleanup = ChatApiService.sendMessageStream(
      {
        message: messageContent,
        conversationId: conversation.id,
        userId,
      },
      streamingOptions
    );

    // Store cleanup function (could be used for component cleanup)
    return cleanup;
  };

  const handleSendMessageRegular = async (messageContent: string) => {
    if (!conversation) return;

    setIsLoading(true);

    try {
      const response = await ChatApiService.sendMessage({
        message: messageContent,
        conversationId: conversation.id,
        userId,
      });

      const assistantMessage: Message = {
        role: "ASSISTANT",
        content: response.data.message,
        timestamp: new Date(response.data.timestamp),
        toolUsages: response.data.toolsUsed,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      pingMechanism.handleAssistantMessage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setMessages((prev) => prev.slice(0, -1));
      pingMechanism.stopPinging();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex w-full h-screen max-w-7xl mx-auto">
      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="p-3 border-b sm:p-4 bg-background">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">AI Assistant</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {conversation
                  ? `Conversation: ${conversation.title}`
                  : "No conversation selected"}
              </p>
            </div>
            <div className="flex gap-2">
              <Link to="/dashboard">
                <Button variant="outline" size="sm">
                  <BarChart3 className="mr-2 w-4 h-4" />
                  Dashboard
                </Button>
              </Link>

              {/* Streaming Toggle */}
              <Button
                variant={useStreaming ? "default" : "outline"}
                size="sm"
                onClick={() => setUseStreaming(!useStreaming)}
                disabled={isLoading || isStreaming}
              >
                {useStreaming ? "🚀 Streaming" : "📝 Regular"}
              </Button>

              <Button
                onClick={createNewConversation}
                disabled={isLoading}
                size="sm"
              >
                <Plus className="mr-2 w-4 h-4" />
                New Chat
              </Button>

              <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogTrigger asChild>
                  <Button
                    // variant="outline"
                    size="sm"
                    onClick={loadUserConversations}
                  >
                    <MessageSquare className="mr-2 w-4 h-4" />
                    Conversations
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Your Conversations</DialogTitle>
                  </DialogHeader>
                  <div className="overflow-y-auto max-h-96">
                    {isLoadingConversations ? (
                      <div className="space-y-2">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="w-full h-12" />
                        ))}
                      </div>
                    ) : conversations.length === 0 ? (
                      <p className="py-4 text-center text-muted-foreground">
                        No conversations found. Start a new chat!
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {conversations.map((conv) => (
                          <Card
                            key={conv.id}
                            className={`p-3 cursor-pointer hover:bg-muted transition-colors ${
                              conversation?.id === conv.id ? "bg-muted" : ""
                            }`}
                            onClick={() => selectConversation(conv)}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="text-sm font-medium">
                                  {conv.title}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(
                                    conv.createdAt
                                  ).toLocaleDateString()}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="p-0 w-8 h-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => deleteConversation(conv.id, e)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Cost Counter */}
          {conversation && (
            <div className="flex justify-center">
              <TokenCounter conversation={conversation} />
            </div>
          )}

          {/* Streaming Progress Indicator */}
          {isStreaming && streamingEvents.length > 0 && (
            <div className="mt-2 p-2 bg-blue-50 rounded-lg border">
              <div className="text-xs font-medium text-blue-700 mb-1">
                🚀 Streaming in progress...
              </div>
              <div className="text-xs text-blue-600">
                {streamingEvents.slice(-1)[0]?.data?.message ||
                  streamingEvents.slice(-1)[0]?.data?.step ||
                  "Processing..."}
              </div>
              {streamingEvents.length > 1 && (
                <div className="text-xs text-blue-500 mt-1">
                  {streamingEvents.length} steps completed
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Messages Area */}
        <div className="overflow-hidden flex-1">
          <ScrollArea className="h-full" ref={scrollAreaRef}>
            <div className="p-4 space-y-4">
              {messages.length === 0 && !isLoading && (
                <Card className="p-8 text-center">
                  <div className="text-muted-foreground">
                    <p className="mb-2 text-lg">Welcome to AI Assistant!</p>
                    {conversation ? (
                      <p>Start chatting by typing a message below.</p>
                    ) : (
                      <p>
                        Click "New Chat" to start a conversation or browse your
                        existing conversations.
                      </p>
                    )}
                  </div>
                </Card>
              )}

              {messages.map((message, index) => (
                <ChatMessage key={index} message={message} />
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex gap-3">
                    <div className="flex justify-center items-center w-8 h-8 rounded-full bg-primary">
                      <div className="w-4 h-4 rounded-full animate-pulse bg-primary-foreground" />
                    </div>
                    <Card className="bg-muted">
                      <div className="p-3 space-y-2">
                        <Skeleton className="h-4 w-[200px]" />
                        <Skeleton className="h-4 w-[150px]" />
                      </div>
                    </Card>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Input Area */}
        <ChatInput
          onSendMessage={handleSendMessage}
          disabled={isLoading || isStreaming || !conversation}
          placeholder={
            !conversation
              ? "Start a new conversation to begin chatting..."
              : isStreaming
              ? "Streaming response in progress..."
              : "Type your message... (Press Enter to send, Shift+Enter for new line)"
          }
        />
      </div>

      {/* Context Sidebar */}
      <div className="border-l">
        <ContextSidebar
          conversationId={conversation?.id || null}
          realtimeIntentAnalysis={pingMechanism.latestIntentAnalysis}
          realtimeSummaries={pingMechanism.latestSummaries}
          isPingingActive={pingMechanism.isActive}
          pingError={pingMechanism.error}
        />
      </div>
    </div>
  );
}
