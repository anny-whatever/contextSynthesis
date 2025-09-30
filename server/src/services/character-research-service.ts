import { PrismaClient } from "@prisma/client";
import { UsageTrackingService } from "./usage-tracking-service";
import OpenAI from "openai";

export interface CharacterDetectionResult {
  isSpecificCharacter: boolean;
  characterName?: string | undefined;
  characterSource?: string | undefined;
  confidence: number;
}

export interface CharacterResearchData {
  basicInfo: {
    name: string;
    source: string;
    occupation?: string;
    personality: string[];
  };
  attributes: {
    catchphrases: string[];
    relationships: Array<{
      name: string;
      type: string;
      dynamic: string;
    }>;
    traits: {
      communication: string;
      expertise: string;
      quirks: string;
    };
    backstory: string;
  };
  rawSources: {
    wikipedia?: string;
    webSearches: string[];
  };
}

export class CharacterResearchService {
  private prisma: PrismaClient;
  private usageTracking: UsageTrackingService;
  private openai: OpenAI;

  constructor(prisma: PrismaClient, usageTracking: UsageTrackingService) {
    this.prisma = prisma;
    this.usageTracking = usageTracking;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Detect if the user is requesting a specific character roleplay
   */
  async detectSpecificCharacter(
    baseRole: string,
    conversationContext?: string
  ): Promise<CharacterDetectionResult> {
    try {
      // Simple detection patterns for specific characters
      const specificIndicators = [
        /from\s+(.+)/i, // "Donna from Suits"
        /as\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i, // "as Albert Einstein"
        /like\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i, // "like Sherlock Holmes"
        /(Einstein|Sherlock|Donna|Harvey|Naruto|Goku|Tony Stark)/i, // Known names
      ];

      let detectedName = "";
      let detectedSource = "";
      let confidence = 0.3;

      // Check for specific character patterns
      for (const pattern of specificIndicators) {
        const match = baseRole.match(pattern);
        if (match) {
          confidence = 0.8;

          // Extract character name and source
          const fromMatch = baseRole.match(/(.+?)\s+from\s+(.+)/i);
          if (fromMatch && fromMatch[1] && fromMatch[2]) {
            detectedName = fromMatch[1].trim();
            detectedSource = fromMatch[2].trim();
            confidence = 0.95;
            break;
          }

          // Extract just name
          const nameMatch = baseRole.match(
            /(?:as|like)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
          );
          if (nameMatch && nameMatch[1]) {
            detectedName = nameMatch[1].trim();
            confidence = 0.85;
            break;
          }

          // Known character detected
          if (match[0]) {
            detectedName = match[0].trim();
            confidence = 0.7;
            break;
          }
        }
      }

      // Generic roles don't need research
      const genericRoles =
        /^(teacher|doctor|lawyer|engineer|friend|assistant|helper)$/i;
      if (genericRoles.test(baseRole.trim())) {
        return {
          isSpecificCharacter: false,
          confidence: 0.9,
        };
      }

      const isSpecific = confidence > 0.6 && detectedName.length > 0;

      if (isSpecific) {
        return {
          isSpecificCharacter: true,
          characterName: detectedName,
          characterSource:
            detectedSource.length > 0 ? detectedSource : undefined,
          confidence,
        };
      }

      return {
        isSpecificCharacter: false,
        confidence,
      };
    } catch (error) {
      console.error("Error detecting specific character:", error);
      return {
        isSpecificCharacter: false,
        confidence: 0,
      };
    }
  }

  /**
   * Research a specific character using web searches
   * Returns structured data about the character
   */
  async researchCharacter(
    characterName: string,
    characterSource?: string,
    webSearchTool?: any
  ): Promise<CharacterResearchData | null> {
    try {
      console.log(
        `🔍 [CHARACTER-RESEARCH] Starting research for: ${characterName}${
          characterSource ? ` from ${characterSource}` : ""
        }`
      );

      if (!webSearchTool) {
        console.warn(
          "⚠️ [CHARACTER-RESEARCH] No web search tool provided, returning mock data"
        );
        return this.createMockCharacterData(characterName, characterSource);
      }

      // Build parallel search queries
      const searches = this.buildSearchQueries(characterName, characterSource);

      console.log(
        `🔍 [CHARACTER-RESEARCH] Executing ${searches.length} parallel searches`
      );

      // Execute searches in parallel
      const searchResults = await Promise.allSettled(
        searches.map((query) =>
          webSearchTool.execute({ query }, { trackUsage: false })
        )
      );

      // Extract successful results
      const successfulResults = searchResults
        .filter(
          (result): result is PromiseSettledResult<any> =>
            result.status === "fulfilled"
        )
        .map((result: any) => result.value?.data?.results || "");

      console.log(
        `✅ [CHARACTER-RESEARCH] Completed ${successfulResults.length}/${searches.length} searches`
      );

      // Parse and structure the research data
      const researchData = await this.parseResearchResults(
        characterName,
        characterSource || "Unknown",
        successfulResults
      );

      return researchData;
    } catch (error) {
      console.error(
        "❌ [CHARACTER-RESEARCH] Error researching character:",
        error
      );
      return null;
    }
  }

  /**
   * Build intelligent search queries for character research
   */
  private buildSearchQueries(
    characterName: string,
    characterSource?: string
  ): string[] {
    const baseQuery = characterSource
      ? `${characterName} ${characterSource}`
      : characterName;

    return [
      `${baseQuery} character personality traits`,
      `${baseQuery} famous quotes catchphrases`,
      `${baseQuery} character analysis backstory`,
      `${baseQuery} relationships character dynamics`,
      `Wikipedia ${baseQuery} character`,
    ];
  }

  /**
   * Parse web search results into structured character data using AI analysis
   */
  private async parseResearchResults(
    characterName: string,
    characterSource: string,
    searchResults: string[]
  ): Promise<CharacterResearchData> {
    try {
      // Combine all search results
      const combinedText = searchResults.join("\n\n");

      if (!combinedText.trim()) {
        console.warn("⚠️ [CHARACTER-RESEARCH] No search results to parse, using fallback");
        return this.createMockCharacterData(characterName, characterSource);
      }

      console.log(`🤖 [CHARACTER-RESEARCH] Using AI to analyze search results for ${characterName}`);

      // Use AI to extract structured character data from search results
      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert character analyst. Extract detailed character information from web search results and format it as JSON.

IMPORTANT: Extract REAL, SPECIFIC information from the provided search results. DO NOT use generic placeholders or templates.

Return a JSON object with this exact structure:
{
  "basicInfo": {
    "name": "character name",
    "source": "source material",
    "occupation": "specific occupation/role if mentioned",
    "personality": ["specific", "personality", "traits", "from", "text"]
  },
  "attributes": {
    "catchphrases": ["actual", "quotes", "from", "search", "results"],
    "relationships": [
      {
        "name": "character name",
        "type": "relationship type",
        "dynamic": "description of their relationship"
      }
    ],
    "traits": {
      "communication": "specific communication style based on search results",
      "expertise": "specific skills/abilities mentioned in search results",
      "quirks": "unique characteristics mentioned in search results"
    },
    "backstory": "detailed backstory information from search results"
  }
}

Extract information ONLY from the provided search results. Be specific and detailed.`
          },
          {
            role: "user",
            content: `Character: ${characterName} from ${characterSource}

Search Results:
${combinedText}

Extract detailed character information from these search results and format as JSON. Focus on specific quotes, personality traits, relationships, and backstory details mentioned in the text.`
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const aiResponse = completion.choices[0]?.message?.content;
      if (!aiResponse) {
        throw new Error("No response from AI analysis");
      }

      // Parse the AI response as JSON
      let parsedData;
      try {
        // Extract JSON from the response (in case it's wrapped in markdown)
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? jsonMatch[0] : aiResponse;
        parsedData = JSON.parse(jsonString);
      } catch (parseError) {
        console.error("❌ [CHARACTER-RESEARCH] Failed to parse AI response as JSON:", parseError);
        throw new Error("Failed to parse AI analysis");
      }

      // Validate and structure the data
      const structuredData: CharacterResearchData = {
        basicInfo: {
          name: characterName,
          source: characterSource,
          occupation: parsedData.basicInfo?.occupation || undefined,
          personality: Array.isArray(parsedData.basicInfo?.personality) 
            ? parsedData.basicInfo.personality.slice(0, 8) // Limit to 8 traits
            : ["determined", "strong-willed"]
        },
        attributes: {
          catchphrases: Array.isArray(parsedData.attributes?.catchphrases)
            ? parsedData.attributes.catchphrases.slice(0, 10) // Limit to 10 catchphrases
            : [],
          relationships: Array.isArray(parsedData.attributes?.relationships)
            ? parsedData.attributes.relationships.slice(0, 8) // Limit to 8 relationships
            : [],
          traits: {
            communication: parsedData.attributes?.traits?.communication || 
              "Direct and passionate communication style",
            expertise: parsedData.attributes?.traits?.expertise || 
              `Combat skills and martial arts mastery`,
            quirks: parsedData.attributes?.traits?.quirks || 
              "Unique fighting spirit and determination"
          },
          backstory: parsedData.attributes?.backstory || 
            `${characterName} is a powerful warrior from ${characterSource} with a complex history of battles and personal growth.`
        },
        rawSources: {
          webSearches: searchResults,
        },
      };

      console.log(`✅ [CHARACTER-RESEARCH] Successfully parsed character data with ${structuredData.attributes.catchphrases.length} catchphrases and ${structuredData.attributes.relationships.length} relationships`);

      return structuredData;

    } catch (error) {
      console.error("❌ [CHARACTER-RESEARCH] Error in AI analysis:", error);
      console.log("🔄 [CHARACTER-RESEARCH] Falling back to basic extraction");
      
      // Fallback to basic extraction if AI fails
      return this.basicParseResearchResults(characterName, characterSource, searchResults);
    }
  }

  /**
   * Fallback method for basic parsing when AI analysis fails
   */
  private basicParseResearchResults(
    characterName: string,
    characterSource: string,
    searchResults: string[]
  ): CharacterResearchData {
    // Combine all search results
    const combinedText = searchResults.join("\n\n");

    // Extract personality traits (improved keyword extraction)
    const personalityKeywords = [
      "confident", "intelligent", "witty", "loyal", "brave", "cunning", "kind", 
      "sarcastic", "determined", "ambitious", "strong", "powerful", "heroic",
      "battle-hungry", "protective", "naive", "pure-hearted", "optimistic"
    ];
    const foundPersonality = personalityKeywords.filter((trait) =>
      combinedText.toLowerCase().includes(trait)
    );

    // Extract potential catchphrases (look for quoted text)
    const catchphrases: string[] = [];
    const quoteMatches = combinedText.match(/"([^"]{5,150})"/g);
    if (quoteMatches) {
      catchphrases.push(
        ...quoteMatches.slice(0, 8).map((q) => q.replace(/"/g, "").trim())
      );
    }

    // Extract character names for relationships (basic approach)
    const relationships: Array<{name: string; type: string; dynamic: string}> = [];
    const nameMatches = combinedText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g);
    if (nameMatches) {
      const uniqueNames = [...new Set(nameMatches)]
        .filter(name => name !== characterName && name.length > 2)
        .slice(0, 5);
      
      relationships.push(...uniqueNames.map(name => ({
        name,
        type: "ally/rival",
        dynamic: `Important relationship with ${name}`
      })));
    }

    // Build structured data with extracted information
    return {
      basicInfo: {
        name: characterName,
        source: characterSource,
        personality: foundPersonality.length > 0 ? foundPersonality : ["strong", "determined", "heroic"],
      },
      attributes: {
        catchphrases: catchphrases.length > 0 ? catchphrases : [],
        relationships,
        traits: {
          communication: "Direct and passionate communication style",
          expertise: `Martial arts mastery and combat expertise`,
          quirks: `Strong sense of justice and love for fighting strong opponents`,
        },
        backstory: `${characterName} is a legendary warrior from ${characterSource} known for incredible strength and unwavering determination to protect others.`,
      },
      rawSources: {
        webSearches: searchResults,
      },
    };
  }

  /**
   * Create mock character data for testing or fallback
   */
  private createMockCharacterData(
    characterName: string,
    characterSource?: string
  ): CharacterResearchData {
    return {
      basicInfo: {
        name: characterName,
        source: characterSource || "Unknown",
        personality: ["intelligent", "confident"],
      },
      attributes: {
        catchphrases: [`Signature phrase of ${characterName}`],
        relationships: [],
        traits: {
          communication: "Direct and articulate",
          expertise: "Context-specific knowledge",
          quirks: "Unique character traits",
        },
        backstory: `${characterName} is a character${
          characterSource ? ` from ${characterSource}` : ""
        }`,
      },
      rawSources: {
        webSearches: [],
      },
    };
  }
}
