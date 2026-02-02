/**
 * TypeRepository - Manages type definitions in the global database
 *
 * Types are global (not project-scoped) - same vocabulary across all projects.
 * Supports soft delete to allow types to be retired without breaking historical data.
 */

import { eq, and } from "drizzle-orm";
import { types, type TypeRow, type NewType } from "@dev-workflow/database/schema.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import type {
  TypeRepository,
  TypeEntity,
  CreateTypeData,
  UpdateTypeData,
} from "./type-definition.js";

/**
 * Drizzle implementation of TypeRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Works with any Drizzle-supported database dialect.
 * Like ProjectRepository, this is NOT scoped to a project since types are global.
 */
export class DrizzleTypeRepository implements TypeRepository {
  constructor(private readonly db: DrizzleDb) {}

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

    const created = this.findRowById(id);
    return this.mapRowToEntity(created!);
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

    const updated = this.findRowByName(name);
    return this.mapRowToEntity(updated!);
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

    const deleted = this.findRowByName(name, true);
    return this.mapRowToEntity(deleted!);
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

    const restored = this.findRowByName(name);
    return this.mapRowToEntity(restored!);
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
      .limit(1)
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
      .limit(1)
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
