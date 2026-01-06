/**
 * Type Service Infrastructure
 *
 * Handles parsing of user-defined types from ./.track/types.md
 * and provides intelligent type assignment based on descriptions.
 *
 * File Format (./.track/types.md):
 * ```markdown
 * ## FEATURE
 * New functionality that doesn't exist yet
 *
 * ## BUG
 * Something is broken or not working as expected
 * ```
 */

import type { IssueType } from "../../domain/issue.js";
import {
  type TypeDefinition,
  type TypeDefinitions,
  DEFAULT_TYPE_DEFINITIONS,
} from "../../domain/type-definition.js";
import type { FileSystem } from "../file-system/file-system.js";

/**
 * Valid issue types that can be defined
 */
const VALID_ISSUE_TYPES: Set<string> = new Set(["FEATURE", "BUG", "ENHANCEMENT", "TASK"]);

/**
 * Type service error
 */
export class TypeServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TypeServiceError";
  }
}

/**
 * Configuration for type service
 */
export interface TypeServiceConfig {
  /** Path to local types.md: ./.track/types.md */
  localTypesPath: string;
  /** Path to global types.md (fallback): ~/.track/config/types.md */
  globalTypesPath: string;
}

/**
 * Type Service
 *
 * Parses user-defined types from ./.track/types.md and provides
 * intelligent type assignment based on descriptions.
 */
export class TypeService {
  private cachedTypes: TypeDefinitions | null = null;

  constructor(
    private readonly fileSystem: FileSystem,
    private readonly config: TypeServiceConfig
  ) {}

  /**
   * Load type definitions from ./.track/types.md or fall back to defaults
   *
   * Resolution order:
   * 1. Local ./.track/types.md
   * 2. Global ~/.track/config/types.md
   * 3. Default hardcoded types
   */
  async loadTypes(): Promise<TypeDefinitions> {
    if (this.cachedTypes) {
      return this.cachedTypes;
    }

    // Try local types.md first
    const localTypes = await this.parseTypesFile(this.config.localTypesPath);
    if (localTypes.length > 0) {
      this.cachedTypes = { types: localTypes, isUserDefined: true };
      return this.cachedTypes;
    }

    // Try global types.md
    const globalTypes = await this.parseTypesFile(this.config.globalTypesPath);
    if (globalTypes.length > 0) {
      this.cachedTypes = { types: globalTypes, isUserDefined: true };
      return this.cachedTypes;
    }

    // Fall back to defaults
    this.cachedTypes = { types: DEFAULT_TYPE_DEFINITIONS, isUserDefined: false };
    return this.cachedTypes;
  }

  /**
   * Select the best matching type for a description
   *
   * Uses keyword matching against type descriptions.
   * Falls back to FEATURE if no match is found.
   *
   * @param description - Issue description to match
   * @returns The best matching IssueType
   */
  async selectType(description: string): Promise<IssueType> {
    const { types } = await this.loadTypes();
    const lower = description.toLowerCase();

    // Score each type based on keyword matches
    let bestMatch: { type: IssueType; score: number } = { type: "FEATURE", score: 0 };

    for (const typeDef of types) {
      let score = 0;

      // Check keywords
      for (const keyword of typeDef.keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      // Also check description words
      const descWords = typeDef.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && lower.includes(word)) {
          score += 0.5;
        }
      }

      if (score > bestMatch.score) {
        bestMatch = { type: typeDef.name, score };
      }
    }

    return bestMatch.type;
  }

  /**
   * Clear the type cache
   */
  clearCache(): void {
    this.cachedTypes = null;
  }

  /**
   * Parse a types.md file into TypeDefinitions
   *
   * @param filePath - Path to types.md file
   * @returns Array of parsed TypeDefinitions (empty if file not found)
   */
  private async parseTypesFile(filePath: string): Promise<TypeDefinition[]> {
    try {
      const exists = await this.fileSystem.exists(filePath);
      if (!exists) {
        return [];
      }

      const content = await this.fileSystem.readFile(filePath);
      return this.parseTypesContent(content);
    } catch {
      // Graceful degradation - return empty on any error
      return [];
    }
  }

  /**
   * Parse types.md content into TypeDefinitions
   *
   * Format:
   * ```
   * ## TYPE_NAME
   * Description paragraph
   *
   * ## ANOTHER_TYPE
   * Another description
   * ```
   *
   * @param content - Raw markdown content
   * @returns Array of parsed TypeDefinitions
   */
  private parseTypesContent(content: string): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const lines = content.split("\n");

    let currentType: string | null = null;
    let currentDescription: string[] = [];

    const saveCurrentType = () => {
      if (currentType && currentDescription.length > 0) {
        const description = currentDescription.join(" ").trim();
        const keywords = this.extractKeywords(description);

        // Validate type name
        if (this.isValidTypeName(currentType)) {
          types.push({
            name: currentType as IssueType,
            description,
            keywords,
          });
        }
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for type header: ## TYPE_NAME
      const headerMatch = trimmed.match(/^##\s+([A-Z_]+)\s*$/);
      if (headerMatch) {
        // Save previous type if any
        saveCurrentType();

        // Start new type
        currentType = headerMatch[1];
        currentDescription = [];
        continue;
      }

      // Accumulate description lines (skip empty lines and other headers)
      if (currentType && trimmed && !trimmed.startsWith("#")) {
        currentDescription.push(trimmed);
      }
    }

    // Save last type
    saveCurrentType();

    return types;
  }

  /**
   * Validate a type name
   *
   * Must be uppercase, no spaces, and one of the valid types.
   */
  private isValidTypeName(name: string): boolean {
    // Must be uppercase with no spaces
    if (!/^[A-Z_]+$/.test(name)) {
      return false;
    }

    // Must be a valid issue type
    return VALID_ISSUE_TYPES.has(name);
  }

  /**
   * Extract keywords from a description
   *
   * Extracts meaningful words (4+ chars) as keywords.
   */
  private extractKeywords(description: string): string[] {
    const words = description.toLowerCase().split(/\s+/);
    const keywords: string[] = [];

    // Common stop words to exclude
    const stopWords = new Set([
      "that",
      "this",
      "with",
      "from",
      "have",
      "been",
      "will",
      "would",
      "could",
      "should",
      "there",
      "their",
      "what",
      "when",
      "where",
      "which",
      "while",
      "about",
      "after",
      "before",
      "between",
      "into",
      "through",
      "during",
      "under",
      "again",
      "further",
      "then",
      "once",
      "here",
      "just",
      "only",
      "other",
      "some",
      "such",
      "than",
      "very",
      "same",
      "also",
      "does",
      "doesn",
      "isn",
      "aren",
      "wasn",
      "weren",
      "hasn",
      "haven",
      "hadn",
    ]);

    for (const word of words) {
      // Remove punctuation
      const clean = word.replace(/[^a-z]/g, "");

      // Keep meaningful words (4+ chars, not stop words)
      if (clean.length >= 4 && !stopWords.has(clean)) {
        keywords.push(clean);
      }
    }

    return [...new Set(keywords)]; // Deduplicate
  }
}
