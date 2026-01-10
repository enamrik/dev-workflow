import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { DatabaseFactory } from "./database-factory.js";
import type { DatabaseAdapter } from "./database-adapter.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DataSourceProvider,
  SqliteDrizzleDatabase,
  ConnectionInfo,
  ConnectionTestResult,
} from "../../domain/data-source.js";
import { ConnectionError, MigrationError } from "../../domain/data-source.js";
import type { ProjectRepository } from "../../domain/project.js";
import type { IssueRepository } from "../../domain/issue.js";
import type { PlanRepository } from "../../domain/plan.js";
import type { TaskRepository } from "../../domain/task.js";
import type { MilestoneRepository } from "../../domain/milestone.js";
import type { SnapshotRepository } from "../../domain/snapshot.js";
import type { TypeRepository } from "../../domain/type-definition.js";
import { SqliteProjectRepository } from "../repositories/project-repository.js";
import { SqliteIssueRepository } from "../repositories/issue-repository.js";
import { SqlitePlanRepository } from "../repositories/plan-repository.js";
import { SqliteTaskRepository } from "../repositories/task-repository.js";
import { SqliteMilestoneRepository } from "../repositories/milestone-repository.js";
import { SqliteSnapshotRepository } from "../repositories/snapshot-repository.js";
import { SqliteTypeRepository } from "../repositories/type-repository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SQLite implementation of DataSourceProvider
 *
 * Supports both native (better-sqlite3) and WebAssembly (sql.js) backends
 * with automatic fallback for maximum compatibility.
 *
 * This is the default data source for single-user/single-machine scenarios.
 */
export class SqliteDataSource implements DataSourceProvider {
  readonly providerId = "sqlite";
  readonly displayName = "SQLite";
  readonly isRemote = false;

  private db: BetterSQLite3Database<typeof schema>;
  private adapter: DatabaseAdapter;
  private databasePath: string;

  /** Cached ProjectRepository instance */
  private projectRepository: ProjectRepository | null = null;

  /** Cached TypeRepository instance */
  private typeRepository: TypeRepository | null = null;

  private constructor(adapter: DatabaseAdapter, databasePath: string) {
    this.adapter = adapter;
    this.databasePath = databasePath;
    // Drizzle works with any SQLite-compatible interface
    this.db = drizzle(adapter as any, { schema });
  }

  /**
   * Create a new SqliteDataSource instance
   *
   * Automatically detects and uses the best available SQLite backend:
   * - Native (better-sqlite3) if available (fastest)
   * - WebAssembly (sql.js) as fallback (always works)
   *
   * @param databasePath - Path to the SQLite database file
   */
  static async create(databasePath: string): Promise<SqliteDataSource> {
    try {
      const adapter = await DatabaseFactory.createAdapter(databasePath);
      return new SqliteDataSource(adapter, databasePath);
    } catch (error) {
      throw new ConnectionError(
        `Failed to open SQLite database: ${error instanceof Error ? error.message : String(error)}`,
        "sqlite",
        databasePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get Drizzle database instance for queries
   */
  getDb(): SqliteDrizzleDatabase {
    return this.db;
  }

  /**
   * Run database migrations
   *
   * Uses drizzle-kit generated migrations from the drizzle/ folder.
   * Migrations are executed in order based on the journal.
   */
  runMigrations(): void {
    try {
      // Path to drizzle migrations folder (relative to compiled JS in dist/)
      // In production: dist/infrastructure/database.js -> ../../drizzle/
      const migrationsFolder = path.resolve(__dirname, "../../drizzle");

      // Use Drizzle's built-in migrator which tracks applied migrations automatically
      migrate(this.db, { migrationsFolder });
    } catch (error) {
      throw new MigrationError(
        `Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`,
        "sqlite",
        error instanceof Error ? error : undefined
      );
    }
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

  /**
   * Test the database connection
   *
   * For SQLite, this always succeeds if the database is open.
   * We perform a simple query to verify the connection is working.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const start = Date.now();
      // Simple query to verify connection
      this.adapter.exec("SELECT 1");
      const latencyMs = Date.now() - start;

      return {
        success: true,
        latencyMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get connection information for display/logging
   */
  getConnectionInfo(): ConnectionInfo {
    return {
      dialect: "sqlite",
      description: this.databasePath,
      isRemote: false,
    };
  }

  /**
   * Get the underlying adapter type (native or wasm)
   *
   * Useful for debugging and logging.
   */
  getAdapterType(): "native" | "wasm" {
    return this.adapter.type;
  }

  // ===========================================================================
  // Repository Factory Methods
  // ===========================================================================

  /**
   * Get the ProjectRepository instance for this data source.
   *
   * The instance is cached and reused across calls.
   */
  getProjectRepository(): ProjectRepository {
    if (!this.projectRepository) {
      this.projectRepository = new SqliteProjectRepository(this.db);
    }
    return this.projectRepository;
  }

  /**
   * Get the TypeRepository instance for this data source.
   *
   * TypeRepository is NOT scoped to a project since types are global.
   * The instance is cached and reused across calls.
   */
  getTypeRepository(): TypeRepository {
    if (!this.typeRepository) {
      this.typeRepository = new SqliteTypeRepository(this.db);
    }
    return this.typeRepository;
  }

  /**
   * Create an IssueRepository scoped to a specific project.
   */
  createIssueRepository(projectId: string): IssueRepository {
    return new SqliteIssueRepository(this.db, projectId);
  }

  /**
   * Create a PlanRepository.
   *
   * Note: PlanRepository is not scoped to a project directly - plans belong to issues.
   */
  createPlanRepository(_projectId: string): PlanRepository {
    return new SqlitePlanRepository(this.db);
  }

  /**
   * Create a TaskRepository.
   *
   * Note: TaskRepository is not scoped to a project directly - tasks belong to plans.
   */
  createTaskRepository(_projectId: string): TaskRepository {
    return new SqliteTaskRepository(this.db);
  }

  /**
   * Create a MilestoneRepository scoped to a specific project.
   */
  createMilestoneRepository(projectId: string): MilestoneRepository {
    return new SqliteMilestoneRepository(this.db, projectId);
  }

  /**
   * Create a SnapshotRepository scoped to a specific project.
   */
  createSnapshotRepository(projectId: string): SnapshotRepository {
    return new SqliteSnapshotRepository(this.db, projectId);
  }
}
