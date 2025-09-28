import { Avatar, AvatarFallback } from '../ui/avatar';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Bot, User } from 'lucide-react';
import MarkdownRenderer from '../ui/MarkdownRenderer';
import type { Message } from '../../types/chat';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'USER';
  const isAssistant = message.role === 'ASSISTANT';

  return (
    <div className={`flex w-full gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Avatar for assistant (left side) */}
      {isAssistant && (
        <Avatar className="h-8 w-8 mt-1">
          <AvatarFallback className="bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}

      {/* Message content */}
      <div className={`flex flex-col max-w-[85%] sm:max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <Card className={`${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted'
        }`}>
          <CardContent className="p-3">
            <div className="text-sm">
              <MarkdownRenderer 
                content={message.content}
                className={`${
                  isUser 
                    ? 'prose-invert prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-code:text-primary-foreground prose-pre:bg-primary-foreground/10' 
                    : 'prose-slate'
                }`}
              />
            </div>
          </CardContent>
        </Card>

        {/* Tool usages for assistant messages */}
        {isAssistant && message.toolUsages && message.toolUsages.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {message.toolUsages.map((tool, index) => (
              <Badge 
                key={index} 
                variant={tool.success ? "secondary" : "destructive"}
                className="text-xs"
              >
                {tool.toolName}
              </Badge>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </div>
      </div>

      {/* Avatar for user (right side) */}
      {isUser && (
        <Avatar className="h-8 w-8 mt-1">
          <AvatarFallback className="bg-secondary text-secondary-foreground">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}