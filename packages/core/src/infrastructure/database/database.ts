import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { DatabaseFactory } from "./database-factory.js";
import type { DatabaseAdapter } from "./database-adapter.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
   * Uses drizzle-kit generated migrations from the drizzle/ folder.
   * Migrations are executed in order based on the journal.
   */
  runMigrations(): void {
    // Path to drizzle migrations folder (relative to compiled JS in dist/)
    // In production: dist/infrastructure/database.js -> ../../drizzle/
    const migrationsFolder = path.resolve(__dirname, "../../drizzle");

    // Use Drizzle's built-in migrator which tracks applied migrations automatically
    migrate(this.db, { migrationsFolder });
  }

  /**
   * Checkpoint WAL (Write-Ahead Log) to main database file
   *
   * SQLite in WAL mode writes to a separate -wal file first.
   * This method flushes all pending writes to the main .db file,
   * ensuring a consistent state for backups.
   *
   * Uses TRUNCATE mode which:
   * - Checkpoints all frames from WAL to database
   * - Truncates the WAL file to zero bytes
   * - Resets the WAL header
   */
  checkpoint(): void {
    this.adapter.exec("PRAGMA wal_checkpoint(TRUNCATE)");
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
