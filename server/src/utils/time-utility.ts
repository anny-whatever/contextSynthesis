export interface DateRange {
  startDate: Date;
  endDate: Date;
  isValid: boolean;
  dayCount: number;
}

export interface ParsedTimeQuery {
  type: "specific_date" | "date_range" | "relative_time" | "invalid";
  startDate?: Date;
  endDate?: Date;
  originalQuery: string;
  isValid: boolean;
  dayCount?: number;
  error?: string;
}

export class TimeUtility {
  private static readonly MAX_DATE_RANGE_DAYS = 10;

  /**
   * Get current date and time
   */
  static getCurrentDateTime(): Date {
    return new Date();
  }

  /**
   * Get current date at start of day (00:00:00)
   */
  static getCurrentDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * Parse relative time expressions like "yesterday", "last 5 days", "last week"
   */
  static parseRelativeTime(query: string): ParsedTimeQuery {
    const normalizedQuery = query.toLowerCase().trim();
    const now = this.getCurrentDate();

    // Yesterday
    if (normalizedQuery.includes("yesterday")) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        type: "specific_date",
        startDate: yesterday,
        endDate: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000 - 1), // End of day
        originalQuery: query,
        isValid: true,
        dayCount: 1,
      };
    }

    // Today
    if (normalizedQuery.includes("today")) {
      const endOfToday = new Date(now.getTime() + 24 * 60 * 60 * 1000 - 1);
      return {
        type: "specific_date",
        startDate: now,
        endDate: endOfToday,
        originalQuery: query,
        isValid: true,
        dayCount: 1,
      };
    }

    // Last X days
    const lastDaysMatch = normalizedQuery.match(/last\s+(\d+)\s+days?/);
    if (lastDaysMatch && lastDaysMatch[1]) {
      const days = parseInt(lastDaysMatch[1]);
      if (days > this.MAX_DATE_RANGE_DAYS) {
        return {
          type: "relative_time",
          originalQuery: query,
          isValid: false,
          error: `Date range limited to ${this.MAX_DATE_RANGE_DAYS} days maximum. Using last ${this.MAX_DATE_RANGE_DAYS} days instead.`,
          dayCount: this.MAX_DATE_RANGE_DAYS,
        };
      }

      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - days);

      return {
        type: "date_range",
        startDate,
        endDate: now,
        originalQuery: query,
        isValid: true,
        dayCount: days,
      };
    }

    // Last week
    if (normalizedQuery.includes("last week")) {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);

      return {
        type: "date_range",
        startDate,
        endDate: now,
        originalQuery: query,
        isValid: true,
        dayCount: 7,
      };
    }

    // Last month (limited to 10 days)
    if (normalizedQuery.includes("last month")) {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - this.MAX_DATE_RANGE_DAYS);

      return {
        type: "date_range",
        startDate,
        endDate: now,
        originalQuery: query,
        isValid: false,
        error: `Month range too large. Limited to last ${this.MAX_DATE_RANGE_DAYS} days.`,
        dayCount: this.MAX_DATE_RANGE_DAYS,
      };
    }

    // Conversational time phrases for recent topics
    const conversationalPhrases = [
      "last thing we talked about",
      "last thing we discussed",
      "most recent",
      "latest discussion",
      "latest",
      "recent conversation",
      "recent",
      "just now",
      "earlier",
      "before",
      "last conversation",
      "last time",
      "previous",
    ];

    const hasConversationalPhrase = conversationalPhrases.some((phrase) =>
      normalizedQuery.includes(phrase.toLowerCase())
    );

    if (hasConversationalPhrase) {
      // For conversational phrases, return today's range to get the most recent topics
      const endOfToday = new Date(now.getTime() + 24 * 60 * 60 * 1000 - 1);
      return {
        type: "relative_time",
        startDate: now,
        endDate: endOfToday,
        originalQuery: query,
        isValid: true,
        dayCount: 1,
      };
    }

    return {
      type: "invalid",
      originalQuery: query,
      isValid: false,
      error: "Could not parse relative time expression",
    };
  }

  /**
   * Parse specific date strings in various formats
   */
  static parseSpecificDate(dateString: string): ParsedTimeQuery {
    const normalizedDate = dateString.trim();

    // First try natural language parsing using JavaScript's Date constructor
    const naturalDate = new Date(normalizedDate);
    if (!isNaN(naturalDate.getTime())) {
      // Validate it's a reasonable date (not too far in past/future)
      const currentYear = new Date().getFullYear();
      const dateYear = naturalDate.getFullYear();
      if (dateYear >= currentYear - 10 && dateYear <= currentYear + 10) {
        const endOfDay = new Date(
          naturalDate.getTime() + 24 * 60 * 60 * 1000 - 1
        );
        return {
          type: "specific_date",
          startDate: naturalDate,
          endDate: endOfDay,
          originalQuery: dateString,
          isValid: true,
          dayCount: 1,
        };
      }
    }

    // Try different date formats
    const dateFormats = [
      // ISO format: 2025-08-05
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      // US format: 08/05/2025 or 8/5/2025
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      // European format: 05/08/2025 or 5/8/2025
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      // Dot format: 05.08.2025
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
      // Dash format: 05-08-2025
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    ];

    for (const format of dateFormats) {
      const match = normalizedDate.match(format);
      if (match && match[1] && match[2] && match[3]) {
        let year: number, month: number, day: number;

        if (format === dateFormats[0]) {
          // ISO format
          year = parseInt(match[1]);
          month = parseInt(match[2]) - 1; // JS months are 0-indexed
          day = parseInt(match[3]);
        } else {
          // Other formats - assume MM/DD/YYYY
          month = parseInt(match[1]) - 1; // JS months are 0-indexed
          day = parseInt(match[2]);
          year = parseInt(match[3]);
        }

        const date = new Date(year, month, day);

        // Validate the date
        if (
          date.getFullYear() === year &&
          date.getMonth() === month &&
          date.getDate() === day
        ) {
          const endOfDay = new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
          return {
            type: "specific_date",
            startDate: date,
            endDate: endOfDay,
            originalQuery: dateString,
            isValid: true,
            dayCount: 1,
          };
        }
      }
    }

    return {
      type: "invalid",
      originalQuery: dateString,
      isValid: false,
      error: "Could not parse date format",
    };
  }

  /**
   * Parse date range strings like "5th august 2025 to 10th august 2025"
   */
  static parseDateRange(rangeString: string): ParsedTimeQuery {
    const normalizedRange = rangeString.toLowerCase().trim();

    // Split by common range separators
    const rangeSeparators = [" to ", " - ", " until ", " through ", " and "];
    let startDateStr = "";
    let endDateStr = "";

    for (const separator of rangeSeparators) {
      if (normalizedRange.includes(separator)) {
        const parts = normalizedRange.split(separator);
        if (parts.length === 2 && parts[0] && parts[1]) {
          startDateStr = parts[0].trim();
          endDateStr = parts[1].trim();
          break;
        }
      }
    }

    if (!startDateStr || !endDateStr) {
      return {
        type: "invalid",
        originalQuery: rangeString,
        isValid: false,
        error: "Could not parse date range format",
      };
    }

    const startResult = this.parseSpecificDate(startDateStr);
    const endResult = this.parseSpecificDate(endDateStr);

    if (
      !startResult.isValid ||
      !endResult.isValid ||
      !startResult.startDate ||
      !endResult.startDate
    ) {
      return {
        type: "invalid",
        originalQuery: rangeString,
        isValid: false,
        error: "Invalid date format in range",
      };
    }

    const dayCount =
      Math.ceil(
        (endResult.startDate.getTime() - startResult.startDate.getTime()) /
          (24 * 60 * 60 * 1000)
      ) + 1;

    if (dayCount > this.MAX_DATE_RANGE_DAYS) {
      return {
        type: "date_range",
        originalQuery: rangeString,
        isValid: false,
        error: `Date range limited to ${this.MAX_DATE_RANGE_DAYS} days maximum`,
        dayCount,
      };
    }

    return {
      type: "date_range",
      startDate: startResult.startDate,
      endDate: endResult.endDate!,
      originalQuery: rangeString,
      isValid: true,
      dayCount,
    };
  }

  /**
   * Main parsing function that tries to parse any time-related query
   */
  static parseTimeQuery(query: string): ParsedTimeQuery {
    const normalizedQuery = query.toLowerCase().trim();

    // Check for relative time expressions first
    if (
      normalizedQuery.includes("yesterday") ||
      normalizedQuery.includes("today") ||
      normalizedQuery.includes("last") ||
      normalizedQuery.includes("ago")
    ) {
      return this.parseRelativeTime(query);
    }

    // Check for date ranges
    if (
      normalizedQuery.includes(" to ") ||
      normalizedQuery.includes(" - ") ||
      normalizedQuery.includes(" until ") ||
      normalizedQuery.includes(" through ") ||
      normalizedQuery.includes(" and ")
    ) {
      return this.parseDateRange(query);
    }

    // Try parsing as specific date
    return this.parseSpecificDate(query);
  }

  /**
   * Create a date range with validation
   */
  static createDateRange(startDate: Date, endDate: Date): DateRange {
    const dayCount =
      Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
      ) + 1;

    return {
      startDate,
      endDate,
      isValid: dayCount <= this.MAX_DATE_RANGE_DAYS && startDate <= endDate,
      dayCount,
    };
  }

  /**
   * Format date for display
   */
  static formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  /**
   * Format date range for display
   */
  static formatDateRange(startDate: Date, endDate: Date): string {
    if (this.isSameDay(startDate, endDate)) {
      return this.formatDate(startDate);
    }
    return `${this.formatDate(startDate)} to ${this.formatDate(endDate)}`;
  }

  /**
   * Check if two dates are the same day
   */
  static isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  /**
   * Get the maximum allowed date range in days
   */
  static getMaxDateRangeDays(): number {
    return this.MAX_DATE_RANGE_DAYS;
  }
}
