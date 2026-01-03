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

/**
 * Type for the test database instance
 */
export type TestDatabase = {
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
 */
export function createTestDatabase(): TestDatabase {
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

  return {
    db,
    sqlite,
    path: ":memory:",
    cleanup: () => {
      sqlite.close();
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
