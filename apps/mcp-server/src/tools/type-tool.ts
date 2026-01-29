/**
 * TypeTool - Issue/task type management operations
 *
 * Provides operations for managing type definitions.
 * Types are stored in the global database and are universal across all projects.
 */

import type { TypeService } from "@dev-workflow/tracking";

// =============================================================================
// Types
// =============================================================================

export interface TypeInfo {
  name: string;
  description: string;
  remoteLabel: string;
}

export interface TypeDetails extends TypeInfo {
  displayName?: string;
  keywords: string[];
}

export interface CreateTypeInput {
  name: string;
  displayName: string;
  description: string;
  keywords?: string[];
  color?: string;
}

export interface UpdateTypeInput {
  name: string;
  updates: {
    displayName?: string;
    description?: string;
    keywords?: string[];
    color?: string | null;
  };
}

export interface DeleteTypeInput {
  name: string;
}

export interface ListTypesResult {
  types: TypeInfo[];
  message: string;
}

export interface CreateTypeResult {
  type: TypeDetails;
  message: string;
}

export interface UpdateTypeResult {
  type: TypeInfo & { keywords: string[] };
  message: string;
}

export interface DeleteTypeResult {
  type: Pick<TypeInfo, "name" | "description">;
  message: string;
}

// =============================================================================
// TypeTool Class
// =============================================================================

export class TypeTool {
  constructor(private readonly typeService: TypeService) {}

  /**
   * List all available types
   */
  async listTypes(): Promise<ListTypesResult> {
    const types = await this.typeService.getTypes();

    return {
      types: types.map((t) => ({
        name: t.name,
        description: t.description,
        remoteLabel: t.remoteLabel,
      })),
      message: `${types.length} type(s) available. Use these values for the 'type' field in generate_plan tasks.`,
    };
  }

  /**
   * Create a new type
   */
  createType(input: CreateTypeInput): CreateTypeResult {
    const { name, displayName, description, keywords, color } = input;

    const type = this.typeService.createType({
      name,
      displayName,
      description,
      keywords,
      color,
    });

    return {
      type: {
        name: type.name,
        displayName,
        description: type.description,
        keywords: type.keywords,
        remoteLabel: type.remoteLabel,
      },
      message: `Type '${type.name}' created successfully.`,
    };
  }

  /**
   * Update an existing type
   */
  updateType(input: UpdateTypeInput): UpdateTypeResult {
    const { name, updates } = input;

    const type = this.typeService.updateType(name, updates);

    return {
      type: {
        name: type.name,
        description: type.description,
        keywords: type.keywords,
        remoteLabel: type.remoteLabel,
      },
      message: `Type '${type.name}' updated successfully.`,
    };
  }

  /**
   * Delete a type (soft delete)
   */
  deleteType(input: DeleteTypeInput): DeleteTypeResult {
    const { name } = input;

    const type = this.typeService.deleteType(name);

    return {
      type: {
        name: type.name,
        description: type.description,
      },
      message: `Type '${type.name}' deleted successfully. Existing records are preserved.`,
    };
  }
}
