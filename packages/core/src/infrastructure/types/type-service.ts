/**
 * Type Service Infrastructure
 *
 * Provides type management operations backed by the global database.
 * Types are universal across all projects.
 *
 * Main responsibilities:
 * - CRUD operations for type definitions
 * - Intelligent type selection based on descriptions
 * - Type validation
 */

import type { IssueType } from "../../domain/issue.js";
import {
  type TypeDefinition,
  type TypeDefinitions,
  type TypeRepository,
  type TypeEntity,
  type CreateTypeData,
  type UpdateTypeData,
  DEFAULT_TYPE_DEFINITIONS,
} from "../../domain/type-definition.js";

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
 * Type Service
 *
 * Manages type definitions stored in the global database.
 * Provides intelligent type assignment based on descriptions.
 */
export class TypeService {
  private cachedTypes: TypeDefinitions | null = null;

  constructor(private readonly typeRepository: TypeRepository) {}

  /**
   * Load type definitions from the database
   *
   * Falls back to DEFAULT_TYPE_DEFINITIONS if no types are seeded yet.
   * This handles the transition period where database may not have types.
   */
  async loadTypes(): Promise<TypeDefinitions> {
    if (this.cachedTypes) {
      return this.cachedTypes;
    }

    // Load from database
    const dbTypes = this.typeRepository.findActive();

    if (dbTypes.length > 0) {
      this.cachedTypes = {
        types: dbTypes.map((t) => this.entityToDefinition(t)),
        isUserDefined: true,
      };
      return this.cachedTypes;
    }

    // Fall back to defaults if no types in DB (pre-migration state)
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
   * Get all available type definitions
   *
   * Returns the complete list of type definitions with their metadata,
   * including name, description, keywords, and remote label.
   *
   * @returns Array of TypeDefinition objects
   */
  async getTypes(): Promise<TypeDefinition[]> {
    const { types } = await this.loadTypes();
    return types;
  }

  /**
   * Check if a type name is valid
   *
   * Validates that the given type name exists in the available types list.
   *
   * @param typeName - Type name to validate (e.g., "FEATURE", "BUG")
   * @returns true if the type is valid, false otherwise
   */
  async isValidType(typeName: string): Promise<boolean> {
    const types = await this.getTypes();
    return types.some((t) => t.name === typeName);
  }

  /**
   * Get a type definition by name
   *
   * @param typeName - Type name to look up
   * @returns The TypeDefinition if found, undefined otherwise
   */
  async getTypeByName(typeName: string): Promise<TypeDefinition | undefined> {
    const types = await this.getTypes();
    return types.find((t) => t.name === typeName);
  }

  /**
   * Create a new type
   *
   * @param data - Type creation data
   * @returns The created type definition
   * @throws TypeServiceError if type already exists or validation fails
   */
  createType(data: CreateTypeData): TypeDefinition {
    // Validate name format (must be uppercase with underscores only)
    if (!/^[A-Z][A-Z0-9_]*$/.test(data.name)) {
      throw new TypeServiceError(
        `Type name must be uppercase letters, numbers, and underscores, starting with a letter. Got: '${data.name}'`
      );
    }

    try {
      const entity = this.typeRepository.create(data);
      this.clearCache();
      return this.entityToDefinition(entity);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw new TypeServiceError(`Type '${data.name}' already exists`);
      }
      throw new TypeServiceError(`Failed to create type: ${error}`, error);
    }
  }

  /**
   * Update an existing type
   *
   * @param name - Type name to update
   * @param data - Fields to update
   * @returns The updated type definition
   * @throws TypeServiceError if type not found
   */
  updateType(name: string, data: UpdateTypeData): TypeDefinition {
    try {
      const entity = this.typeRepository.update(name, data);
      this.clearCache();
      return this.entityToDefinition(entity);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new TypeServiceError(`Type '${name}' not found`);
      }
      throw new TypeServiceError(`Failed to update type: ${error}`, error);
    }
  }

  /**
   * Delete a type (soft delete)
   *
   * @param name - Type name to delete
   * @returns The deleted type definition
   * @throws TypeServiceError if type not found or already deleted
   */
  deleteType(name: string): TypeDefinition {
    try {
      const entity = this.typeRepository.softDelete(name);
      this.clearCache();
      return this.entityToDefinition(entity);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          throw new TypeServiceError(`Type '${name}' not found`);
        }
        if (error.message.includes("already deleted")) {
          throw new TypeServiceError(`Type '${name}' is already deleted`);
        }
      }
      throw new TypeServiceError(`Failed to delete type: ${error}`, error);
    }
  }

  /**
   * Clear the type cache
   */
  clearCache(): void {
    this.cachedTypes = null;
  }

  /**
   * Convert TypeEntity to TypeDefinition
   */
  private entityToDefinition(entity: TypeEntity): TypeDefinition {
    return {
      name: entity.name as IssueType,
      description: entity.description,
      keywords: entity.keywords,
      // Remote label defaults to lowercase name
      remoteLabel: entity.name.toLowerCase(),
    };
  }
}
