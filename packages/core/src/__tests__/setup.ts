/**
 * Test Setup
 *
 * This file is run before each test file.
 * It sets up the test database and provides cleanup utilities.
 */

import { afterEach } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../infrastructure/database/schema.js";
import type { DrizzleDb } from "../domain/drizzle-db.js";
import type { DbClient } from "../domain/db-client.js";
import type { DbSource } from "../domain/db-source.js";
import { DrizzleDbClient } from "../infrastructure/database/drizzle-db-client.js";
import { DrizzleProjectRepository } from "../infrastructure/repositories/project-repository.js";
import { DrizzleTypeRepository } from "../infrastructure/repositories/type-repository.js";
import { DrizzleGlobalSettingsRepository } from "../infrastructure/repositories/global-settings-repository.js";

/** Default project ID for tests */
const TEST_PROJECT_ID = "test-project-abc123";

/**
 * Type for the raw drizzle database (for direct SQL operations in tests)
 */
export type DbType = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Type for the test database instance
 */
export type TestDatabase = {
  /** DbClient for accessing repositories */
  client: DbClient;
  /** DbSource for global repositories and creating clients */
  source: DbSource;
  /** Raw drizzle db for direct SQL operations (e.g., inserting execution logs) */
  db: DbType;
  /** Cleanup function to close the database */
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

  // Run migrations - in-memory DB needs schema created fresh each time
  const migrationsPath = join(__dirname, "../../drizzle");
  if (existsSync(migrationsPath)) {
    migrate(db, { migrationsFolder: migrationsPath });
  }

  // Track for cleanup
  currentTestDb = sqlite;

  // Create DbClient for repository access
  const drizzleDb = db as unknown as DrizzleDb;
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
    createClient: (pid: string) => new DrizzleDbClient(drizzleDb, pid),
    close: () => sqlite.close(),
  };

  return {
    client,
    source,
    db,
    cleanup: () => {
      client.close();
    },
  };
}

/**
 * Reset the database by deleting all data from all tables
 */
export function resetDatabase(sqlite: Database.Database): void {
  // Delete in order to respect foreign keys
  sqlite.exec("DELETE FROM task_status_history");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM plans");
  sqlite.exec("DELETE FROM snapshots");
  sqlite.exec("DELETE FROM issues");
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
