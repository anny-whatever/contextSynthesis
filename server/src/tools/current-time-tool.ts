import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ToolConfig, ToolParameter, ToolResult, ToolContext } from '../types/tool';
import { PrismaClient } from '@prisma/client';
import { TimeUtility } from '../utils/time-utility';

const currentTimeSchema = z.object({
  format: z.enum(['iso', 'locale', 'detailed']).optional().default('detailed').describe('Format for the time output')
});

export class CurrentTimeTool extends BaseTool {
  constructor(prisma?: PrismaClient) {
    const config: ToolConfig = {
      name: 'get_current_time',
      description: 'Get the current date and time since AI agents do not have time perception',
      version: '1.0.0',
      enabled: true,
      timeout: 5000
    };

    const parameters: ToolParameter[] = [
      {
        name: 'format',
        type: 'string',
        description: 'Format for the time output: iso, locale, or detailed',
        required: false,
        default: 'detailed',
        examples: ['iso', 'locale', 'detailed']
      }
    ];

    super(config, parameters, prisma);
  }

  async executeInternal(input: any, context?: ToolContext): Promise<ToolResult> {
    try {
      const validatedInput = currentTimeSchema.parse(input);
      const { format } = validatedInput;

      const now = TimeUtility.getCurrentDateTime();
      const currentDate = TimeUtility.getCurrentDate();
      
      let formattedOutput: string;
      
      switch (format) {
        case 'iso':
          formattedOutput = now.toISOString();
          break;
        case 'locale':
          formattedOutput = now.toLocaleString();
          break;
        case 'detailed':
        default:
          formattedOutput = `${TimeUtility.formatDate(currentDate)} at ${now.toLocaleTimeString()}`;
          break;
      }

      // Calculate relative time references for context
      const yesterday = new Date(currentDate);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const lastWeek = new Date(currentDate);
      lastWeek.setDate(lastWeek.getDate() - 7);

      return {
        success: true,
        data: {
          currentDateTime: now.toISOString(),
          currentDate: currentDate.toISOString(),
          formattedOutput,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          relativeReferences: {
            yesterday: TimeUtility.formatDate(yesterday),
            lastWeek: TimeUtility.formatDate(lastWeek),
            today: TimeUtility.formatDate(currentDate)
          },
          dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
          month: now.toLocaleDateString('en-US', { month: 'long' }),
          year: now.getFullYear()
        },
        metadata: {
          purpose: 'time_awareness_for_ai',
          format,
          executionTime: Date.now()
        }
      };
    } catch (error) {
      console.error('Error getting current time:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null
      };
    }
  }
}