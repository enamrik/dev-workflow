/**
 * TypeRepository - Manages type definitions in the global database
 *
 * Types are global (not project-scoped) - same vocabulary across all projects.
 * Supports soft delete to allow types to be retired without breaking historical data.
 */

import { eq, and } from "drizzle-orm";
import { types, TypeRow, NewType } from "../database/schema.js";
import type { SqliteDrizzleDatabase } from "../../domain/data-source.js";

/**
 * Type entity as stored in the database
 */
export interface TypeEntity {
  id: string;
  /** Type name - uppercase identifier (e.g., "FEATURE", "BUG", "SPIKE") */
  name: string;
  /** Human-readable display name (e.g., "Feature", "Bug", "Spike") */
  displayName: string;
  /** Description for intelligent type selection */
  description: string;
  /** Keywords for intelligent matching */
  keywords: string[];
  /** Optional UI color (hex string, e.g., "#ff0000") */
  color?: string;
  /** Soft delete flag */
  isDeleted: boolean;
  /** Timestamp when soft deleted */
  deletedAt?: string;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

/**
 * Data for creating a new type
 */
export interface CreateTypeData {
  name: string;
  displayName: string;
  description: string;
  keywords?: string[];
  color?: string;
}

/**
 * Data for updating an existing type
 */
export interface UpdateTypeData {
  displayName?: string;
  description?: string;
  keywords?: string[];
  color?: string | null;
}

/**
 * Interface for type repository
 */
export interface TypeRepository {
  /**
   * Create a new type
   *
   * @param data - Type data
   * @returns The created type
   * @throws Error if type with same name already exists
   */
  create(data: CreateTypeData): TypeEntity;

  /**
   * Update an existing type
   *
   * @param name - Type name to update
   * @param data - Fields to update
   * @returns The updated type
   * @throws Error if type not found
   */
  update(name: string, data: UpdateTypeData): TypeEntity;

  /**
   * Soft delete a type
   *
   * @param name - Type name to delete
   * @returns The deleted type
   * @throws Error if type not found or already deleted
   */
  softDelete(name: string): TypeEntity;

  /**
   * Restore a soft-deleted type
   *
   * @param name - Type name to restore
   * @returns The restored type
   * @throws Error if type not found or not deleted
   */
  restore(name: string): TypeEntity;

  /**
   * Find a type by name
   *
   * @param name - Type name to find
   * @param includeDeleted - Whether to include soft-deleted types
   * @returns The type or null if not found
   */
  findByName(name: string, includeDeleted?: boolean): TypeEntity | null;

  /**
   * Find a type by ID
   *
   * @param id - Type ID to find
   * @param includeDeleted - Whether to include soft-deleted types
   * @returns The type or null if not found
   */
  findById(id: string, includeDeleted?: boolean): TypeEntity | null;

  /**
   * Get all types
   *
   * @param includeDeleted - Whether to include soft-deleted types
   * @returns Array of types
   */
  findAll(includeDeleted?: boolean): TypeEntity[];

  /**
   * Get all active (non-deleted) types
   *
   * @returns Array of active types
   */
  findActive(): TypeEntity[];

  /**
   * Check if there are any types in the database
   *
   * @returns true if there are types (including deleted), false otherwise
   */
  hasAny(): boolean;

  /**
   * Seed initial types (for setup)
   *
   * @param types - Array of types to seed
   */
  seedTypes(types: CreateTypeData[]): void;
}

/**
 * SQLite implementation of TypeRepository
 */
export class SqliteTypeRepository implements TypeRepository {
  constructor(private readonly db: SqliteDrizzleDatabase) {}

  create(data: CreateTypeData): TypeEntity {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Check if type with same name already exists (including deleted)
    const existing = this.findByName(data.name, true);
    if (existing) {
      throw new Error(`Type '${data.name}' already exists`);
    }

    const newType: NewType = {
      id,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      keywords: data.keywords ?? [],
      color: data.color ?? null,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(types).values(newType).run();

    return this.mapRowToEntity(this.findRowById(id)!);
  }

  update(name: string, data: UpdateTypeData): TypeEntity {
    const existing = this.findByName(name);
    if (!existing) {
      throw new Error(`Type '${name}' not found`);
    }

    const now = new Date().toISOString();
    const updateData: Partial<TypeRow> = {
      updatedAt: now,
    };

    if (data.displayName !== undefined) {
      updateData.displayName = data.displayName;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.keywords !== undefined) {
      updateData.keywords = data.keywords;
    }
    if ("color" in data) {
      updateData.color = data.color ?? null;
    }

    this.db.update(types).set(updateData).where(eq(types.name, name)).run();

    return this.mapRowToEntity(this.findRowByName(name)!);
  }

  softDelete(name: string): TypeEntity {
    // Check with includeDeleted=true to distinguish "not found" from "already deleted"
    const existing = this.findByName(name, true);
    if (!existing) {
      throw new Error(`Type '${name}' not found`);
    }

    if (existing.isDeleted) {
      throw new Error(`Type '${name}' is already deleted`);
    }

    const now = new Date().toISOString();

    this.db
      .update(types)
      .set({
        isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(types.name, name))
      .run();

    return this.mapRowToEntity(this.findRowByName(name, true)!);
  }

  restore(name: string): TypeEntity {
    const existing = this.findByName(name, true);
    if (!existing) {
      throw new Error(`Type '${name}' not found`);
    }

    if (!existing.isDeleted) {
      throw new Error(`Type '${name}' is not deleted`);
    }

    const now = new Date().toISOString();

    this.db
      .update(types)
      .set({
        isDeleted: false,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(types.name, name))
      .run();

    return this.mapRowToEntity(this.findRowByName(name)!);
  }

  findByName(name: string, includeDeleted = false): TypeEntity | null {
    const row = this.findRowByName(name, includeDeleted);
    return row ? this.mapRowToEntity(row) : null;
  }

  findById(id: string, includeDeleted = false): TypeEntity | null {
    const row = this.findRowById(id, includeDeleted);
    return row ? this.mapRowToEntity(row) : null;
  }

  findAll(includeDeleted = false): TypeEntity[] {
    const conditions = [];
    if (!includeDeleted) {
      conditions.push(eq(types.isDeleted, false));
    }

    const rows =
      conditions.length > 0
        ? this.db
            .select()
            .from(types)
            .where(and(...conditions))
            .all()
        : this.db.select().from(types).all();

    return rows.map((row) => this.mapRowToEntity(row));
  }

  findActive(): TypeEntity[] {
    return this.findAll(false);
  }

  hasAny(): boolean {
    const result = this.db.select().from(types).limit(1).get();
    return result !== undefined;
  }

  seedTypes(typesToSeed: CreateTypeData[]): void {
    const now = new Date().toISOString();

    for (const type of typesToSeed) {
      // Check if already exists
      const existing = this.findByName(type.name, true);
      if (!existing) {
        const newType: NewType = {
          id: crypto.randomUUID(),
          name: type.name,
          displayName: type.displayName,
          description: type.description,
          keywords: type.keywords ?? [],
          color: type.color ?? null,
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };

        this.db.insert(types).values(newType).run();
      }
    }
  }

  private findRowByName(name: string, includeDeleted = false): TypeRow | undefined {
    const conditions = [eq(types.name, name)];
    if (!includeDeleted) {
      conditions.push(eq(types.isDeleted, false));
    }

    return this.db
      .select()
      .from(types)
      .where(and(...conditions))
      .get();
  }

  private findRowById(id: string, includeDeleted = false): TypeRow | undefined {
    const conditions = [eq(types.id, id)];
    if (!includeDeleted) {
      conditions.push(eq(types.isDeleted, false));
    }

    return this.db
      .select()
      .from(types)
      .where(and(...conditions))
      .get();
  }

  private mapRowToEntity(row: TypeRow): TypeEntity {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      keywords: row.keywords,
      color: row.color ?? undefined,
      isDeleted: row.isDeleted,
      deletedAt: row.deletedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
