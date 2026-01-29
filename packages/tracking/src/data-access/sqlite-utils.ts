/**
 * SQLite utility functions
 *
 * Low-level SQLite operations that don't fit in the DbClient interface.
 */

import * as path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const require = createRequire(import.meta.url);

/**
 * Checkpoint a SQLite database's WAL (Write-Ahead Log).
 *
 * Flushes pending writes to the main database file.
 * Call this before backup operations to ensure all data is on disk.
 *
 * @param dbPath - Path to the SQLite database file
 */
export function checkpointSqliteDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

/**
 * Run migrations on a SQLite database.
 *
 * This is a convenience wrapper for databases that need migrations
 * outside the normal DbClient flow (e.g., during CLI initialization).
 *
 * @param dbPath - Path to the SQLite database file
 */
export function runSqliteMigrations(dbPath: string): void {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const drizzleDb = drizzle(db);
  // Resolve the database package and find the drizzle migrations folder
  const databasePackage = require.resolve("@dev-workflow/database/schema.js");
  const migrationsFolder = path.join(path.dirname(databasePackage), "drizzle");
  migrate(drizzleDb, { migrationsFolder });

  db.close();
}
