import { Request, Response, NextFunction } from 'express';
import { CustomError } from './error-handler';

export interface ChatRequest {
  message: string;
  conversationId?: string;
  userId?: string;
  context?: Record<string, any>;
}

export interface CreateConversationRequest {
  title?: string;
  userId?: string;
}

export const validateChatRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { message, conversationId, userId, context } = req.body as ChatRequest;

  // Validate required fields
  if (!message || typeof message !== 'string') {
    throw new CustomError('Message is required and must be a string', 400);
  }

  if (message.trim().length === 0) {
    throw new CustomError('Message cannot be empty', 400);
  }

  if (message.length > 10000) {
    throw new CustomError('Message is too long (max 10000 characters)', 400);
  }

  // Validate optional fields
  if (conversationId && typeof conversationId !== 'string') {
    throw new CustomError('Conversation ID must be a string', 400);
  }

  if (userId && typeof userId !== 'string') {
    throw new CustomError('User ID must be a string', 400);
  }

  if (context && typeof context !== 'object') {
    throw new CustomError('Context must be an object', 400);
  }

  // Sanitize message
  req.body.message = message.trim();

  next();
};

export const validateCreateConversationRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { title, userId } = req.body as CreateConversationRequest;

  // Validate optional fields
  if (title && typeof title !== 'string') {
    throw new CustomError('Title must be a string', 400);
  }

  if (title && title.length > 200) {
    throw new CustomError('Title is too long (max 200 characters)', 400);
  }

  if (userId && typeof userId !== 'string') {
    throw new CustomError('User ID must be a string', 400);
  }

  // Sanitize title
  if (title) {
    req.body.title = title.trim();
  }

  next();
};

export const validateConversationId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const conversationId = req.params.conversationId || req.params.id;

  if (!conversationId || typeof conversationId !== 'string') {
    throw new CustomError('Valid conversation ID is required', 400);
  }

  // Basic cuid validation (Prisma uses cuid by default)
  if (conversationId.length < 20 || conversationId.length > 30) {
    throw new CustomError('Invalid conversation ID format', 400);
  }

  // Store the conversationId in a consistent place for route handlers
  req.params.conversationId = conversationId;

  next();
};

export const validateUserId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { userId } = req.params;

  if (!userId || typeof userId !== 'string') {
    throw new CustomError('Valid user ID is required', 400);
  }

  next();
};

export const sanitizeInput = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Basic XSS protection - remove script tags and dangerous content
  const sanitizeString = (str: string): string => {
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  };

  const sanitizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }
    
    return obj;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};