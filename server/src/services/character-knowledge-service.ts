import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { encode } from "gpt-tokenizer";
import { UsageTrackingService } from "./usage-tracking-service";
import { CharacterResearchData } from "./character-research-service";

export interface KnowledgeChunk {
  type: string;
  content: string;
  tokenCount: number;
  metadata?: any;
}

export interface CharacterKnowledgeGraph {
  characterId: string;
  basicInfo: CharacterResearchData["basicInfo"];
  attributes: CharacterResearchData["attributes"];
  chunks: KnowledgeChunk[];
}

export interface RAGRetrievalResult {
  chunks: Array<{
    type: string;
    content: string;
    similarity?: number;
  }>;
  systemPrompt: string;
}

export class CharacterKnowledgeService {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private usageTracking: UsageTrackingService;
  private readonly EMBEDDING_MODEL = "text-embedding-3-small";
  private readonly MAX_CHUNK_TOKENS = 512;
  private readonly TOP_K = 3;

  constructor(
    prisma: PrismaClient,
    openai: OpenAI,
    usageTracking: UsageTrackingService
  ) {
    this.prisma = prisma;
    this.openai = openai;
    this.usageTracking = usageTracking;
  }

  /**
   * Build knowledge graph from research data and store it
   */
  async buildAndStoreKnowledgeGraph(
    conversationId: string,
    characterName: string,
    characterSource: string,
    researchData: CharacterResearchData
  ): Promise<string | null> {
    try {
      console.log(
        `📊 [CHARACTER-KG] Building knowledge graph for ${characterName}`
      );

      // Deactivate existing character knowledge for this conversation
      await this.deactivateCharacterKnowledge(conversationId);

      // Build knowledge graph
      const knowledgeGraph = this.buildKnowledgeGraph(
        characterName,
        researchData
      );

      // Generate system prompt
      const systemPrompt = this.generateSystemPrompt(
        characterName,
        characterSource,
        researchData
      );

      // Create chunks from knowledge graph
      const chunks = this.createAttributeBasedChunks(researchData);

      console.log(`📦 [CHARACTER-KG] Created ${chunks.length} chunks`);

      // Generate embeddings for chunks
      const chunksWithEmbeddings = await this.generateEmbeddings(chunks);

      // Store in database
      const characterKnowledgeId = await this.storeKnowledgeGraph(
        conversationId,
        characterName,
        characterSource,
        knowledgeGraph,
        systemPrompt,
        chunksWithEmbeddings
      );

      console.log(
        `✅ [CHARACTER-KG] Stored knowledge graph: ${characterKnowledgeId}`
      );

      return characterKnowledgeId;
    } catch (error) {
      console.error("❌ [CHARACTER-KG] Error building knowledge graph:", error);
      return null;
    }
  }

  /**
   * Retrieve relevant character knowledge chunks for a user query
   */
  async retrieveCharacterContext(
    conversationId: string,
    userQuery: string
  ): Promise<RAGRetrievalResult | null> {
    try {
      // Get active character knowledge
      const characterKnowledge = await this.prisma.characterKnowledge.findFirst(
        {
          where: {
            conversationId,
            isActive: true,
          },
          include: {
            chunks: true,
          },
        }
      );

      if (!characterKnowledge) {
        return null;
      }

      console.log(
        `🔍 [CHARACTER-RAG] Retrieving context for query in conversation ${conversationId}`
      );

      // Generate embedding for user query
      const queryEmbedding = await this.generateQueryEmbedding(userQuery);

      // Find top-K similar chunks using pgvector
      const similarChunks = await this.findSimilarChunks(
        characterKnowledge.id,
        queryEmbedding,
        this.TOP_K
      );

      console.log(
        `✅ [CHARACTER-RAG] Retrieved ${similarChunks.length} relevant chunks`
      );

      return {
        chunks: similarChunks,
        systemPrompt: characterKnowledge.systemPrompt,
      };
    } catch (error) {
      console.error(
        "❌ [CHARACTER-RAG] Error retrieving character context:",
        error
      );
      return null;
    }
  }

  /**
   * Get active character knowledge for a conversation
   */
  async getActiveCharacterKnowledge(conversationId: string) {
    try {
      return await this.prisma.characterKnowledge.findFirst({
        where: {
          conversationId,
          isActive: true,
        },
        include: {
          chunks: {
            select: {
              id: true,
              chunkType: true,
              content: true,
              tokenCount: true,
              metadata: true,
            },
          },
        },
      });
    } catch (error) {
      console.error("Error getting active character knowledge:", error);
      return null;
    }
  }

  /**
   * Deactivate character knowledge for a conversation
   */
  async deactivateCharacterKnowledge(conversationId: string): Promise<void> {
    try {
      await this.prisma.characterKnowledge.updateMany({
        where: {
          conversationId,
          isActive: true,
        },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Error deactivating character knowledge:", error);
    }
  }

  /**
   * Build knowledge graph structure
   */
  private buildKnowledgeGraph(
    characterName: string,
    researchData: CharacterResearchData
  ): CharacterKnowledgeGraph {
    return {
      characterId: characterName.toLowerCase().replace(/\s+/g, "-"),
      basicInfo: researchData.basicInfo,
      attributes: researchData.attributes,
      chunks: [],
    };
  }

  /**
   * Generate info-dense system prompt for character
   */
  private generateSystemPrompt(
    characterName: string,
    characterSource: string,
    researchData: CharacterResearchData
  ): string {
    const { basicInfo, attributes } = researchData;

    return `## CHARACTER: ${characterName}${
      characterSource ? ` (${characterSource})` : ""
    }

CORE IDENTITY: ${basicInfo.personality.slice(0, 4).join(", ")}${
      basicInfo.occupation ? `. ${basicInfo.occupation}` : ""
    }. ${attributes.backstory.slice(0, 150)}

COMMUNICATION: ${attributes.traits.communication}. ${
      attributes.catchphrases.length > 0
        ? `Known phrases: "${attributes.catchphrases[0]}"`
        : ""
    }

KEY TRAITS: ${attributes.traits.expertise}. ${attributes.traits.quirks}

RESPONSE STYLE: Embody ${characterName}'s personality authentically. Stay in character at all times. Use character knowledge to inform responses.`;
  }

  /**
   * Create attribute-based chunks from research data
   */
  private createAttributeBasedChunks(
    researchData: CharacterResearchData
  ): KnowledgeChunk[] {
    const chunks: KnowledgeChunk[] = [];
    const { basicInfo, attributes } = researchData;

    // Personality chunk
    const personalityContent = `Personality: ${
      basicInfo.name
    } is characterized by being ${basicInfo.personality.join(", ")}. ${
      attributes.traits.communication
    }`;
    chunks.push({
      type: "personality",
      content: personalityContent,
      tokenCount: encode(personalityContent).length,
      metadata: { category: "personality" },
    });

    // Catchphrases chunks (one per catchphrase if many, or grouped)
    if (attributes.catchphrases.length > 0) {
      const catchphrasesContent = `Signature phrases: ${attributes.catchphrases
        .slice(0, 5)
        .map((cp) => `"${cp}"`)
        .join(", ")}. Use these naturally in conversation.`;
      chunks.push({
        type: "catchphrase",
        content: catchphrasesContent,
        tokenCount: encode(catchphrasesContent).length,
        metadata: { category: "catchphrase" },
      });
    }

    // Expertise/Knowledge chunk
    const expertiseContent = `Expertise and Skills: ${attributes.traits.expertise}. ${attributes.traits.quirks}`;
    chunks.push({
      type: "expertise",
      content: expertiseContent,
      tokenCount: encode(expertiseContent).length,
      metadata: { category: "expertise" },
    });

    // Backstory chunk
    const backstoryContent = `Background: ${attributes.backstory}`;
    if (encode(backstoryContent).length <= this.MAX_CHUNK_TOKENS) {
      chunks.push({
        type: "backstory",
        content: backstoryContent,
        tokenCount: encode(backstoryContent).length,
        metadata: { category: "backstory" },
      });
    } else {
      // Split backstory if too long
      const sentences = attributes.backstory.match(/[^.!?]+[.!?]+/g) || [
        attributes.backstory,
      ];
      let currentChunk = "";

      sentences.forEach((sentence) => {
        const testChunk = currentChunk + " " + sentence;
        if (encode(testChunk).length <= this.MAX_CHUNK_TOKENS) {
          currentChunk = testChunk;
        } else {
          if (currentChunk) {
            chunks.push({
              type: "backstory",
              content: `Background: ${currentChunk.trim()}`,
              tokenCount: encode(currentChunk).length,
              metadata: { category: "backstory" },
            });
          }
          currentChunk = sentence;
        }
      });

      if (currentChunk) {
        chunks.push({
          type: "backstory",
          content: `Background: ${currentChunk.trim()}`,
          tokenCount: encode(currentChunk).length,
          metadata: { category: "backstory" },
        });
      }
    }

    // Relationship chunks
    if (attributes.relationships.length > 0) {
      attributes.relationships.forEach((rel) => {
        const relContent = `Relationship with ${rel.name}: ${rel.type}. Dynamic: ${rel.dynamic}`;
        if (encode(relContent).length <= this.MAX_CHUNK_TOKENS) {
          chunks.push({
            type: "relationship",
            content: relContent,
            tokenCount: encode(relContent).length,
            metadata: { category: "relationship", relatedTo: rel.name },
          });
        }
      });
    }

    return chunks;
  }

  /**
   * Generate embeddings for chunks
   */
  private async generateEmbeddings(
    chunks: KnowledgeChunk[]
  ): Promise<Array<KnowledgeChunk & { embedding: number[] }>> {
    try {
      const contents = chunks.map((c) => c.content);

      const response = await this.openai.embeddings.create({
        model: this.EMBEDDING_MODEL,
        input: contents,
      });

      // Track usage
      await this.usageTracking.trackUsage({
        operationType: "CHARACTER_EMBEDDING",
        model: this.EMBEDDING_MODEL,
        inputTokens: response.usage?.total_tokens || 0,
        outputTokens: 0,
        success: true,
        metadata: {
          chunkCount: chunks.length,
        },
      });

      return chunks.map((chunk, i) => ({
        ...chunk,
        embedding: response.data[i]?.embedding || [],
      }));
    } catch (error) {
      console.error("Error generating embeddings:", error);
      throw error;
    }
  }

  /**
   * Generate embedding for user query
   */
  private async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.EMBEDDING_MODEL,
        input: query,
      });

      return response.data[0]?.embedding || [];
    } catch (error) {
      console.error("Error generating query embedding:", error);
      throw error;
    }
  }

  /**
   * Find similar chunks using pgvector
   */
  private async findSimilarChunks(
    characterKnowledgeId: string,
    queryEmbedding: number[],
    topK: number
  ): Promise<Array<{ type: string; content: string; similarity?: number }>> {
    try {
      // Use pgvector cosine similarity search
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      const similarChunks = await this.prisma.$queryRaw<
        Array<{
          chunkType: string;
          content: string;
          similarity: number;
        }>
      >`
        SELECT 
          "chunkType",
          content,
          1 - (embedding <=> ${embeddingStr}::vector) as similarity
        FROM character_knowledge_chunks
        WHERE "characterKnowledgeId" = ${characterKnowledgeId}::text
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingStr}::vector
        LIMIT ${topK}::int
      `;

      return similarChunks.map((chunk) => ({
        type: chunk.chunkType,
        content: chunk.content,
        similarity: chunk.similarity,
      }));
    } catch (error) {
      console.error("Error finding similar chunks:", error);

      // Fallback: return all chunks if vector search fails
      const allChunks = await this.prisma.characterKnowledgeChunk.findMany({
        where: { characterKnowledgeId },
        take: topK,
        select: {
          chunkType: true,
          content: true,
        },
      });

      return allChunks.map((chunk) => ({
        type: chunk.chunkType,
        content: chunk.content,
      }));
    }
  }

  /**
   * Store knowledge graph and chunks in database
   */
  private async storeKnowledgeGraph(
    conversationId: string,
    characterName: string,
    characterSource: string,
    knowledgeGraph: CharacterKnowledgeGraph,
    systemPrompt: string,
    chunks: Array<KnowledgeChunk & { embedding: number[] }>
  ): Promise<string> {
    try {
      // Create character knowledge
      const characterKnowledge = await this.prisma.characterKnowledge.create({
        data: {
          conversationId,
          characterName,
          characterSource,
          knowledgeGraph: knowledgeGraph as any,
          systemPrompt,
          isActive: true,
        },
      });

      // Create chunks with embeddings
      for (const chunk of chunks) {
        const embeddingStr = `[${chunk.embedding.join(",")}]`;

        await this.prisma.$executeRaw`
          INSERT INTO character_knowledge_chunks (
            id, 
            "characterKnowledgeId", 
            "chunkType", 
            content, 
            "tokenCount", 
            embedding,
            metadata,
            "createdAt"
          )
          VALUES (
            gen_random_uuid()::text,
            ${characterKnowledge.id},
            ${chunk.type},
            ${chunk.content},
            ${chunk.tokenCount},
            ${embeddingStr}::vector,
            ${JSON.stringify(chunk.metadata || {})}::jsonb,
            NOW()
          )
        `;
      }

      return characterKnowledge.id;
    } catch (error) {
      console.error("Error storing knowledge graph:", error);
      throw error;
    }
  }
}
