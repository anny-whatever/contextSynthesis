import OpenAI from 'openai';
import { PrismaClient, Role } from '@prisma/client';
import { ToolRegistry } from '../tools/tool-registry';
import { 
  AgentConfig, 
  AgentRequest, 
  AgentResponse, 
  ConversationContext, 
  MessageContext,
  ToolUsageContext 
} from '../types/agent';

export class AgentService {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private toolRegistry: ToolRegistry;
  private config: AgentConfig;

  constructor(
    openai?: OpenAI,
    prisma?: PrismaClient,
    toolRegistry?: ToolRegistry,
    config?: Partial<AgentConfig>
  ) {
    this.openai = openai || new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    this.prisma = prisma || new PrismaClient();
    this.toolRegistry = toolRegistry || new ToolRegistry(this.prisma);
    
    this.config = {
      model: process.env.DEFAULT_AGENT_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.AGENT_TEMPERATURE || '0.7'),
      maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || '2000'),
      timeout: parseInt(process.env.AGENT_TIMEOUT_MS || '30000'),
      systemPrompt: process.env.AGENT_SYSTEM_PROMPT || this.getDefaultSystemPrompt(),
      enableTools: process.env.AGENT_ENABLE_TOOLS !== 'false',
      maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '20'),
      ...config,
    };
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful AI assistant with access to web search capabilities. 
You can search the web to find current information and provide accurate, up-to-date responses.
When you need to search for information, use the web_search tool.
Always be helpful, accurate, and cite your sources when using web search results.`;
  }

  async processMessage(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    const conversationId = request.conversationId || await this.createNewConversation(request.userId);
    
    try {
      // Load conversation context
      const context = await this.loadConversationContext(conversationId, request.userId);
      
      // Add user message to context
      const userMessage: MessageContext = {
        role: Role.USER,
        content: request.message,
        timestamp: new Date(),
      };
      context.messageHistory.push(userMessage);

      // Prepare messages for OpenAI
      const messages = this.prepareMessagesForOpenAI(context);
      
      // Get tools if enabled
      const tools = this.config.enableTools && request.options?.enableTools !== false
        ? this.toolRegistry.getToolDefinitions()
        : [];

      // Call OpenAI API
      const completionParams: any = {
        model: request.options?.model || this.config.model,
        messages,
        temperature: request.options?.temperature || this.config.temperature,
        max_tokens: request.options?.maxTokens || this.config.maxTokens,
      };

      if (tools.length > 0) {
        completionParams.tools = tools;
        completionParams.tool_choice = 'auto';
      }

      const completion = await this.openai.chat.completions.create(completionParams);

      const assistantMessage = completion.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error('No response from OpenAI');
      }

      // Handle tool calls if present
      const toolsUsed: ToolUsageContext[] = [];
      let finalContent = assistantMessage.content || '';

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolResults = await this.executeToolCalls(assistantMessage.tool_calls);
        toolsUsed.push(...toolResults);

        // Create follow-up completion with tool results
        const toolMessages = [
          ...messages,
          {
            role: 'assistant' as const,
            content: assistantMessage.content,
            tool_calls: assistantMessage.tool_calls,
          },
          ...toolResults.map((result, index) => ({
            role: 'tool' as const,
            tool_call_id: assistantMessage.tool_calls![index]?.id || `tool_${index}`,
            content: JSON.stringify(result.output),
          })),
        ];

        const followUpCompletion = await this.openai.chat.completions.create({
          model: request.options?.model || this.config.model,
          messages: toolMessages,
          temperature: request.options?.temperature || this.config.temperature,
          max_tokens: request.options?.maxTokens || this.config.maxTokens,
        });

        finalContent = followUpCompletion.choices[0]?.message?.content || finalContent;
      }

      // Add assistant message to context
      const assistantMessageContext: MessageContext = {
        role: Role.ASSISTANT,
        content: finalContent,
        timestamp: new Date(),
        toolUsages: toolsUsed,
      };
      context.messageHistory.push(assistantMessageContext);

      // Persist conversation
      await this.persistConversation(context, userMessage, assistantMessageContext, toolsUsed);

      const duration = Date.now() - startTime;

      return {
        message: finalContent,
        conversationId,
        toolsUsed,
        context,
        metadata: {
          model: request.options?.model || this.config.model,
          ...(completion.usage?.total_tokens && { tokensUsed: completion.usage.total_tokens }),
          duration,
          timestamp: new Date(),
        },
      };

    } catch (error) {
      console.error('Agent service error:', error);
      throw new Error(`Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async executeToolCalls(toolCalls: any[]): Promise<ToolUsageContext[]> {
    const results: ToolUsageContext[] = [];

    for (const toolCall of toolCalls) {
      const startTime = Date.now();
      
      try {
        const toolName = toolCall.function.name;
        const toolInput = JSON.parse(toolCall.function.arguments);
        
        const result = await this.toolRegistry.executeTool(toolName, toolInput);
        
        results.push({
          toolName,
          input: toolInput,
          output: result.data || result.error,
          success: result.success,
          duration: Date.now() - startTime,
          ...(result.success ? {} : { error: result.error }),
        });
      } catch (error) {
        results.push({
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
          output: null,
          success: false,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private prepareMessagesForOpenAI(context: ConversationContext): any[] {
    const messages = [
      {
        role: 'system',
        content: this.config.systemPrompt,
      },
    ];

    // Add conversation history (limit to maxConversationHistory)
    const recentMessages = context.messageHistory.slice(-this.config.maxConversationHistory);
    
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role.toLowerCase(),
        content: msg.content,
      });
    }

    return messages;
  }

  private async loadConversationContext(conversationId: string, userId?: string): Promise<ConversationContext> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            include: {
              toolUsages: true,
            },
          },
        },
      });

      if (!conversation) {
        // Create new conversation if it doesn't exist
        const newConversation = await this.prisma.conversation.create({
          data: {
            id: conversationId,
            title: 'New Conversation',
            userId: userId || 'anonymous',
          },
        });

        return {
          conversationId,
          userId: userId || 'anonymous',
          messageHistory: [],
          metadata: {},
        };
      }

      const messageHistory: MessageContext[] = conversation.messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt,
        toolUsages: msg.toolUsages.map(usage => ({
          toolName: usage.toolName,
          input: usage.input as any,
          output: usage.output as any,
          success: usage.status === 'COMPLETED',
          duration: usage.duration || 0,
          error: usage.error || undefined,
        })),
      }));

      return {
        conversationId,
        userId: conversation.userId || 'anonymous',
        messageHistory,
        metadata: {},
      };
    } catch (error) {
      console.error('Error loading conversation context:', error);
      throw new Error('Failed to load conversation context');
    }
  }

  private async createNewConversation(userId?: string): Promise<string> {
    const conversation = await this.prisma.conversation.create({
      data: {
        title: 'New Conversation',
        userId: userId || 'anonymous',
      },
    });
    return conversation.id;
  }

  private async persistConversation(
    context: ConversationContext,
    userMessage: MessageContext,
    assistantMessage: MessageContext,
    toolsUsed: ToolUsageContext[]
  ): Promise<void> {
    try {
      // Save user message
      const savedUserMessage = await this.prisma.message.create({
        data: {
          conversationId: context.conversationId!,
          role: userMessage.role,
          content: userMessage.content,
        },
      });

      // Save assistant message
      const savedAssistantMessage = await this.prisma.message.create({
        data: {
          conversationId: context.conversationId!,
          role: assistantMessage.role,
          content: assistantMessage.content,
        },
      });

      // Save tool usages
      if (toolsUsed.length > 0) {
        await this.prisma.toolUsage.createMany({
          data: toolsUsed.map(tool => ({
            messageId: savedAssistantMessage.id,
            toolName: tool.toolName,
            input: tool.input,
            output: tool.output,
            status: tool.success ? 'COMPLETED' : 'FAILED',
            error: tool.error || null,
            duration: tool.duration || null,
          })),
        });
      }

      // Update conversation timestamp
      await this.prisma.conversation.update({
        where: { id: context.conversationId! },
        data: { updatedAt: new Date() },
      });
    } catch (error) {
      console.error('Error persisting conversation:', error);
      // Don't throw here to avoid breaking the response flow
    }
  }

  async getConversationHistory(conversationId: string): Promise<ConversationContext | null> {
    try {
      return await this.loadConversationContext(conversationId);
    } catch (error) {
      console.error('Error getting conversation history:', error);
      return null;
    }
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      await this.prisma.conversation.delete({
        where: { id: conversationId },
      });
      return true;
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return false;
    }
  }
}