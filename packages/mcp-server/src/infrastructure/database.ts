import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { DatabaseFactory } from "./database-factory.js";
import type { DatabaseAdapter } from "./database-adapter.js";

/**
 * DatabaseService manages SQLite database connection and migrations
 *
 * Responsibilities:
 * - Initialize SQLite connection (native or WASM)
 * - Run database migrations (create tables, indexes)
 * - Provide Drizzle instance for queries
 * - Handle graceful shutdown
 *
 * Uses adapter pattern to support both native (better-sqlite3)
 * and WebAssembly (sql.js) backends with automatic fallback.
 */
export class DatabaseService {
  private db: BetterSQLite3Database<typeof schema>;
  private adapter!: DatabaseAdapter;

  private constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
    // Drizzle works with any SQLite-compatible interface
    this.db = drizzle(adapter as any, { schema });
  }

  /**
   * Create a new DatabaseService instance
   *
   * Automatically detects and uses the best available SQLite backend:
   * - Native (better-sqlite3) if available (fastest)
   * - WebAssembly (sql.js) as fallback (always works)
   */
  static async create(databasePath: string): Promise<DatabaseService> {
    const adapter = await DatabaseFactory.createAdapter(databasePath);
    return new DatabaseService(adapter);
  }

  /**
   * Get Drizzle database instance for queries
   */
  getDb(): BetterSQLite3Database<typeof schema> {
    return this.db;
  }

  /**
   * Run database migrations
   *
   * Creates tables and indexes if they don't exist.
   * This is a simple migration approach - for production,
   * consider using drizzle-kit migrations.
   */
  runMigrations(): void {
    this.adapter.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        labels TEXT NOT NULL DEFAULT '[]',
        template_used TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_issues_number ON issues(number);
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
      CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
    `);
  }

  /**
   * Close database connection
   *
   * Should be called on graceful shutdown to ensure
   * all writes are flushed to disk.
   */
  close(): void {
    this.adapter.close();
  }
}
