/**
 * Test Setup
 *
 * This file is run before each test file.
 * It sets up the test database and provides cleanup utilities.
 */

import { afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../infrastructure/schema.js";

/**
 * Type for the test database instance
 */
export type TestDatabase = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  path: string;
  cleanup: () => void;
};

// Store the current test database path
let currentTestDbPath: string | null = null;
let currentTestDb: Database.Database | null = null;

/**
 * Create a fresh test database with all migrations applied
 */
export function createTestDatabase(): TestDatabase {
  // Create temp directory for this test
  const tempDir = mkdtempSync(join(tmpdir(), "dev-workflow-test-"));
  const dbPath = join(tempDir, "test.db");

  // Create SQLite database
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Run migrations
  const migrationsPath = join(__dirname, "../../drizzle");
  if (existsSync(migrationsPath)) {
    migrate(db, { migrationsFolder: migrationsPath });
  }

  // Track for cleanup
  currentTestDbPath = tempDir;
  currentTestDb = sqlite;

  return {
    db,
    sqlite,
    path: dbPath,
    cleanup: () => {
      sqlite.close();
      rmSync(tempDir, { recursive: true, force: true });
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
  if (currentTestDb) {
    try {
      currentTestDb.close();
    } catch {
      // Ignore close errors
    }
    currentTestDb = null;
  }

  // Clean up temp directory
  if (currentTestDbPath && existsSync(currentTestDbPath)) {
    try {
      rmSync(currentTestDbPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    currentTestDbPath = null;
  }
});
