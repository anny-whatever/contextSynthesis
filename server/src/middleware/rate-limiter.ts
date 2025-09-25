import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// General API rate limiter - DISABLED
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: () => true, // ALWAYS SKIP - RATE LIMITING DISABLED
});

// Stricter rate limiter for chat endpoints - DISABLED
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.CHAT_RATE_LIMIT || '10'), // limit each IP to 10 chat requests per minute
  message: {
    success: false,
    error: {
      message: 'Too many chat requests, please wait before sending another message.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => true, // ALWAYS SKIP - RATE LIMITING DISABLED
});

// Very strict rate limiter for expensive operations - DISABLED
export const expensiveOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.EXPENSIVE_OPERATION_LIMIT || '5'), // limit each IP to 5 expensive operations per hour
  message: {
    success: false,
    error: {
      message: 'Rate limit exceeded for expensive operations. Please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => true, // ALWAYS SKIP - RATE LIMITING DISABLED
});