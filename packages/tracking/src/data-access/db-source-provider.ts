/**
 * DbSourceProvider - Creates DbSource instances from connection strings
 *
 * Usage:
 * ```typescript
 * const provider = new DbSourceProvider();
 * const source = provider.create({ connectionString: "sqlite:///path/to/db.sqlite" });
 *
 * // Provision (migrations, seeding)
 * await source.provision();
 *
 * // Access global repos
 * const project = await source.projects.findBySlug("my-project");
 *
 * // Create project-scoped client
 * const client = source.createClient(project.id);
 * const issues = client.issues.findMany({});
 *
 * source.close();
 * ```
 */

import { Service } from "@dev-workflow/effect";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { migrate as sqliteMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { neon } from "@neondatabase/serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/neon-http";
import { migrate as pgMigrate } from "drizzle-orm/neon-http/migrator";

import * as sqliteSchema from "@dev-workflow/database/schema.js";
import * as pgSchema from "@dev-workflow/database/schema-pg.js";

import type { DbSource } from "./db-source.js";
import type { DbClient } from "./db-client.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

import { DrizzleDbClient } from "./drizzle-db-client.js";
import { DrizzleProjectRepository } from "../domain/projects/project-repository.js";
import { DrizzleTypeRepository } from "../domain/types/type-repository.js";
import { DrizzleGlobalSettingsRepository } from "../domain/global-settings-repository.js";
import { DEFAULT_TYPE_DEFINITIONS } from "../domain/types/type-definition.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// SourceInfo
// =============================================================================

/**
 * Connection info for a data source.
 *
 * Connection string schemes:
 * - sqlite:./relative/path - SQLite with relative path
 * - sqlite:///absolute/path - SQLite with absolute path
 * - sqlite::memory: - SQLite in-memory
 * - postgres:// or postgresql:// - PostgreSQL via Neon
 */
export interface SourceInfo {
  /** Raw connection string */
  readonly connectionString: string;
}

// =============================================================================
// Types
// =============================================================================

type ConnectionType = "sqlite" | "postgres";

interface ParsedConnection {
  type: ConnectionType;
  /** What the driver needs (absolute path or full URL) */
  driverPath: string;
}

// =============================================================================
// DbSourceProvider
// =============================================================================

/**
 * Provider for creating DbSource instances with connection caching
 */
export class DbSourceProvider extends Service<DbSourceProvider>()("sourceProvider") {
  /** Cache of DbSource instances by connection string */
  private readonly sources = new Map<string, DbSource>();

  /**
   * Get or create a DbSource from connection info.
   * Caches sources by connection string (except :memory: which is always unique).
   *
   * @param sourceInfo - Connection info (connectionString)
   * @returns DbSource with global repos and ability to create project-scoped clients
   */
  getOrCreate(sourceInfo: SourceInfo): DbSource {
    // :memory: databases are unique per connection - never cache
    if (sourceInfo.connectionString.includes(":memory:")) {
      return this.createSource(sourceInfo.connectionString);
    }

    const cached = this.sources.get(sourceInfo.connectionString);
    if (cached) return cached;

    const source = this.createSource(sourceInfo.connectionString);
    this.sources.set(sourceInfo.connectionString, source);
    return source;
  }

  /**
   * Close all cached database connections
   */
  closeAll(): void {
    for (const source of this.sources.values()) {
      source.close();
    }
    this.sources.clear();
  }

  /**
   * Check if a connection string is for a remote database
   */
  static isRemote(connectionString: string): boolean {
    return connectionString.startsWith("postgres");
  }

  // ===========================================================================
  // Private - Source Creation
  // ===========================================================================

  private createSource(connectionString: string): DbSource {
    const { type, driverPath } = this.parseConnectionString(connectionString);

    if (type === "sqlite") {
      return this.createSqliteSource(driverPath);
    } else {
      return this.createPostgresSource(driverPath);
    }
  }

  // ===========================================================================
  // Private - SQLite
  // ===========================================================================

  private createSqliteSource(driverPath: string): DbSource {
    const sqlite = new Database(driverPath);
    sqlite.pragma("foreign_keys = ON");
    const db = sqliteDrizzle(sqlite, { schema: sqliteSchema });
    const rawDrizzleDb = db as unknown as DrizzleDb;
    const migrationsFolder = path.resolve(__dirname, "../../../drizzle");

    // Wrap to support async transaction callbacks.
    // better-sqlite3's native transaction() is synchronous and commits before
    // async callbacks finish. We use raw BEGIN/COMMIT/ROLLBACK instead.
    // In SQLite, all operations on the same connection are in the transaction.
    const drizzleDb: DrizzleDb = {
      select: (fields) => rawDrizzleDb.select(fields),
      insert: (table) => rawDrizzleDb.insert(table),
      update: (table) => rawDrizzleDb.update(table),
      delete: (table) => rawDrizzleDb.delete(table),
      async transaction<T>(fn: (tx: DrizzleDb) => Promise<T>): Promise<T> {
        sqlite.exec("BEGIN");
        try {
          const result = await fn(rawDrizzleDb);
          sqlite.exec("COMMIT");
          return result;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      },
    };

    // Create global repositories
    const projects = new DrizzleProjectRepository(drizzleDb);
    const types = new DrizzleTypeRepository(drizzleDb);
    const globalSettings = new DrizzleGlobalSettingsRepository(drizzleDb);

    return {
      provision: async () => {
        // Run migrations
        sqliteMigrate(db, { migrationsFolder });

        // Seed default types if they don't exist
        this.seedDefaultTypes(types);
      },

      projects,
      types,
      globalSettings,

      getDb: () => drizzleDb,

      createClient: (projectId: string): DbClient => {
        return new DrizzleDbClient(drizzleDb, projectId);
      },

      close: () => {
        sqlite.close();
      },
    };
  }

  // ===========================================================================
  // Private - PostgreSQL
  // ===========================================================================

  private createPostgresSource(driverPath: string): DbSource {
    const sql = neon(driverPath);
    const db = pgDrizzle(sql, { schema: pgSchema });
    const drizzleDb = db as unknown as DrizzleDb;
    const migrationsFolder = path.resolve(__dirname, "../../../drizzle-pg");

    // Create global repositories
    const projects = new DrizzleProjectRepository(drizzleDb);
    const types = new DrizzleTypeRepository(drizzleDb);
    const globalSettings = new DrizzleGlobalSettingsRepository(drizzleDb);

    return {
      provision: async () => {
        // Run migrations (async for postgres)
        await pgMigrate(db, { migrationsFolder });

        // Seed default types if they don't exist
        this.seedDefaultTypes(types);
      },

      projects,
      types,
      globalSettings,

      getDb: () => drizzleDb,

      createClient: (projectId: string): DbClient => {
        return new DrizzleDbClient(drizzleDb, projectId);
      },

      close: () => {
        // Neon HTTP is stateless, no close needed
      },
    };
  }

  // ===========================================================================
  // Private - Helpers
  // ===========================================================================

  /**
   * Seed default types if they don't exist
   */
  private seedDefaultTypes(types: DrizzleTypeRepository): void {
    const existingTypes = types.findAll(true);
    const existingNames = new Set(existingTypes.map((t) => t.name));

    const toSeed = DEFAULT_TYPE_DEFINITIONS.filter((t) => !existingNames.has(t.name)).map(
      (typeDef) => ({
        name: typeDef.name,
        displayName: typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase(),
        description: typeDef.description,
        keywords: typeDef.keywords,
      })
    );

    if (toSeed.length > 0) {
      types.seedTypes(toSeed);
    }
  }

  /**
   * Parse raw connection string into type and driver-ready path.
   * Connection strings must use absolute paths.
   */
  private parseConnectionString(raw: string): ParsedConnection {
    // postgres:// or postgresql://
    if (raw.startsWith("postgres")) {
      return { type: "postgres", driverPath: raw };
    }

    // sqlite:///absolute/path (3 slashes)
    if (raw.startsWith("sqlite:///")) {
      let absolutePath = raw.slice(9); // "sqlite://" is 9 chars
      if (absolutePath.startsWith("~")) {
        absolutePath = path.join(os.homedir(), absolutePath.slice(1));
      }
      return { type: "sqlite", driverPath: absolutePath };
    }

    // sqlite::memory:
    if (raw === "sqlite::memory:") {
      return { type: "sqlite", driverPath: ":memory:" };
    }

    throw new Error(
      `Invalid connection string: ${raw}. ` +
        `Expected sqlite:///absolute/path, sqlite::memory:, or postgres://...`
    );
  }
}
