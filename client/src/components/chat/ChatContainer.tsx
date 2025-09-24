import { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Card } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { Skeleton } from '../ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatApiService } from '../../services/chatApi';
import type { Message, Conversation } from '../../types/chat';

export function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // Initialize conversation on component mount
  useEffect(() => {
    initializeConversation();
  }, []);

  const initializeConversation = async () => {
    try {
      setError(null);
      const response = await ChatApiService.createConversation('New Chat');
      setConversation(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize conversation');
    }
  };

  const handleSendMessage = async (messageContent: string) => {
    if (!conversation) {
      setError('No conversation available. Please refresh the page.');
      return;
    }

    // Add user message immediately to UI
    const userMessage: Message = {
      role: 'USER',
      content: messageContent,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      // Send message to backend
      const response = await ChatApiService.sendMessage({
        message: messageContent,
        conversationId: conversation.id,
        userId: 'anonymous',
      });

      // Add assistant response to UI
      const assistantMessage: Message = {
        role: 'ASSISTANT',
        content: response.data.message,
        timestamp: new Date(response.data.timestamp),
        toolUsages: response.data.toolsUsed,
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove the user message if sending failed
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b bg-background">
        <h1 className="text-xl sm:text-2xl font-bold">AI Assistant</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {conversation ? `Conversation: ${conversation.title}` : 'Loading...'}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="p-4 space-y-4">
            {messages.length === 0 && !isLoading && (
              <Card className="p-8 text-center">
                <div className="text-muted-foreground">
                  <p className="text-lg mb-2">Welcome to AI Assistant!</p>
                  <p>Start a conversation by typing a message below.</p>
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
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                    <div className="h-4 w-4 rounded-full bg-primary-foreground animate-pulse" />
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
        disabled={isLoading || !conversation}
        placeholder={
          !conversation 
            ? "Initializing conversation..." 
            : "Type your message... (Press Enter to send, Shift+Enter for new line)"
        }
      />
    </div>
  );
}