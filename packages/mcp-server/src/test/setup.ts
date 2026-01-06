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
import * as schema from "@dev-workflow/core/schema";

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

  // Run migrations from core package - in-memory DB needs schema created fresh each time
  const corePath = require.resolve("@dev-workflow/core");
  const migrationsPath = join(corePath, "../../drizzle");
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
