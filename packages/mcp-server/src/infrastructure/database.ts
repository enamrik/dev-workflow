import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { DatabaseFactory } from "./database-factory.js";
import type { DatabaseAdapter } from "./database-adapter.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

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
    const migrationsPath = path.resolve(__dirname, "../../drizzle");

    try {
      // Read the migration journal to get list of migrations
      const journalPath = path.join(migrationsPath, "meta/_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

      // Execute each migration in order
      for (const entry of journal.entries) {
        const migrationPath = path.join(migrationsPath, `${entry.tag}.sql`);
        const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

        // Split by statement breakpoints and execute each statement
        const statements = migrationSQL
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          this.adapter.exec(statement);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "Migration files not found. Run 'pnpm drizzle-kit generate' in packages/mcp-server first."
        );
      }
      throw error;
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
