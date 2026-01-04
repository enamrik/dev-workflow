import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { DatabaseFactory } from "./database-factory.js";
import type { DatabaseAdapter } from "./database-adapter.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

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
   *
   * After running, verifies all journal entries are applied to catch
   * any silent failures from drizzle's timestamp-based migration tracking.
   *
   * @throws Error if migrations fail or if verification detects missing migrations
   */
  runMigrations(): void {
    // Path to drizzle migrations folder (relative to compiled JS in dist/)
    // In production: dist/infrastructure/database.js -> ../../drizzle/
    const migrationsFolder = path.resolve(__dirname, "../../drizzle");

    // Use Drizzle's built-in migrator which tracks applied migrations automatically
    migrate(this.db, { migrationsFolder });

    // Verify all migrations were applied
    this.verifyMigrations(migrationsFolder);
  }

  /**
   * Verify all journal entries have corresponding records in __drizzle_migrations.
   *
   * Drizzle's migrator uses timestamp-based comparison which can silently skip
   * migrations if they're added out of order. This verification catches such cases.
   *
   * @throws Error if any migrations are missing from the database
   */
  private verifyMigrations(migrationsFolder: string): void {
    const journalPath = path.join(migrationsFolder, "meta/_journal.json");

    // If no journal exists, nothing to verify
    if (!fs.existsSync(journalPath)) {
      return;
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };

    // Get count of applied migrations
    const result = this.db.all<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM __drizzle_migrations`
    );
    const appliedCount = result[0]?.count ?? 0;
    const expectedCount = journal.entries.length;

    if (appliedCount < expectedCount) {
      const missing = expectedCount - appliedCount;
      throw new Error(
        `Migration verification failed: Expected ${expectedCount} migrations but found ${appliedCount}. ` +
          `${missing} migration(s) were not applied. ` +
          `This may indicate a stale dist/drizzle folder. Try running 'pnpm build' to rebuild.`
      );
    }
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
