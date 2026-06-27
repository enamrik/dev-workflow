/**
 * Test Setup for MCP Server
 *
 * Creates test database using core infrastructure.
 */

import { afterEach } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@dev-workflow/database/schema.js";
import {
  DrizzleDbClient,
  DrizzleProjectRepository,
  DrizzleTypeRepository,
  DrizzleGlobalSettingsRepository,
  type DbClient,
  type DbSource,
} from "@dev-workflow/tracking";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

/** Default project ID for tests */
const TEST_PROJECT_ID = "test-project-abc123";

/**
 * Type for the test database instance
 */
export type TestDatabase = {
  /** DbClient for accessing project-scoped repositories */
  client: DbClient;
  /** DbSource for global repositories (projects, types, globalSettings) */
  source: DbSource;
  /** Raw drizzle db for direct SQL operations */
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  path: string;
  cleanup: () => void;
};

// Store current test database for cleanup
let currentTestDb: Database.Database | null = null;

/**
 * Create a fresh test database with all migrations applied
 *
 * Uses SQLite in-memory mode (:memory:) for:
 * - Faster test execution (no disk I/O)
 * - Automatic cleanup (memory freed when connection closes)
 * - Complete isolation between tests
 *
 * @param projectId - Optional project ID for scoped repositories (default: test-project-abc123)
 */
export function createTestDatabase(projectId: string = TEST_PROJECT_ID): TestDatabase {
  // Create in-memory SQLite database
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });

  // Run migrations from database package - in-memory DB needs schema created fresh each time
  const databasePath = require.resolve("@dev-workflow/database/schema.js");
  const migrationsPath = join(databasePath, "../../drizzle");
  if (existsSync(migrationsPath)) {
    migrate(db, { migrationsFolder: migrationsPath });
  }

  // Track for cleanup
  currentTestDb = sqlite;

  // Wrap to support async transaction callbacks (same as DbSourceProvider).
  // better-sqlite3's native transaction() is synchronous and commits before
  // async callbacks finish. We use raw BEGIN/COMMIT/ROLLBACK instead.
  const rawDrizzleDb = db as unknown as DrizzleDb;
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

  // Create DbClient for repository access
  const client = new DrizzleDbClient(drizzleDb, projectId);

  // Create global repositories for DbSource
  const projects = new DrizzleProjectRepository(drizzleDb);
  const types = new DrizzleTypeRepository(drizzleDb);
  const globalSettings = new DrizzleGlobalSettingsRepository(drizzleDb);

  // Create DbSource
  const source: DbSource = {
    provision: async () => {
      // Already migrated above
    },
    projects,
    types,
    globalSettings,
    getDb: () => drizzleDb,
    findProjectSlugByTaskId: (taskId: string): string | null => {
      const result = drizzleDb
        .select({ slug: schema.projects.slug })
        .from(schema.tasks)
        .innerJoin(schema.plans, schema.sql`${schema.plans.id} = ${schema.tasks.planId}`)
        .innerJoin(schema.issues, schema.sql`${schema.issues.id} = ${schema.plans.issueId}`)
        .innerJoin(schema.projects, schema.sql`${schema.projects.id} = ${schema.issues.projectId}`)
        .where(schema.sql`${schema.tasks.id} = ${taskId}`)
        .get();
      return result?.slug ?? null;
    },
    createClient: (pid: string) => new DrizzleDbClient(drizzleDb, pid),
    close: () => sqlite.close(),
  };

  return {
    client,
    source,
    db,
    sqlite,
    path: ":memory:",
    cleanup: () => {
      client.close();
    },
  };
}

// Global cleanup after all tests in a file
afterEach(() => {
  // Close any open database connections
  // In-memory databases are automatically cleaned up when closed
  if (currentTestDb) {
    try {
      currentTestDb.close();
    } catch {
      // Ignore close errors
    }
    currentTestDb = null;
  }
});
