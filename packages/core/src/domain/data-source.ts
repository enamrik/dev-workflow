/**
 * DataSourceProvider - Abstract interface for database backends
 *
 * This interface defines the contract that all database providers must implement.
 * It abstracts database operations to enable pluggable support for SQLite, PostgreSQL
 * (Neon), and potentially other databases.
 *
 * Design decisions:
 * - Provider identity is explicit for logging and debugging
 * - All operations that may be async are async (for remote databases)
 * - Schema-specific operations (like WAL checkpoint) are optional
 * - Connection validation is required for remote databases
 *
 * Following the ProjectManagementProvider pattern for consistency.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type * as sqliteSchema from "../infrastructure/database/schema.js";
import type * as pgSchema from "../infrastructure/database/schema-pg.js";

// =============================================================================
// Database Types
// =============================================================================

/**
 * SQLite Drizzle database instance type
 */
export type SqliteDrizzleDatabase = BetterSQLite3Database<typeof sqliteSchema>;

/**
 * PostgreSQL (Neon) Drizzle database instance type
 */
export type NeonDrizzleDatabase = NeonHttpDatabase<typeof pgSchema>;

/**
 * Union type for all supported Drizzle database instances
 *
 * Repositories should use dialect-agnostic query patterns when possible.
 * For dialect-specific operations, check the provider's `providerId` property.
 */
export type DrizzleDatabase = SqliteDrizzleDatabase | NeonDrizzleDatabase;

/**
 * Database dialect identifier
 */
export type DatabaseDialect = "sqlite" | "postgresql";

// =============================================================================
// Connection Types
// =============================================================================

/**
 * Connection information for display/logging
 */
export interface ConnectionInfo {
  /** Database dialect */
  readonly dialect: DatabaseDialect;

  /** Human-readable connection description (path for SQLite, masked URL for remote) */
  readonly description: string;

  /** Whether the connection is to a remote database */
  readonly isRemote: boolean;
}

/**
 * Result of a connection test
 */
export interface ConnectionTestResult {
  /** Whether the connection succeeded */
  readonly success: boolean;

  /** Latency in milliseconds (for remote databases) */
  readonly latencyMs?: number;

  /** Error message if connection failed */
  readonly error?: string;
}

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * DataSourceProvider - Interface for database backends
 *
 * Implementations:
 * - SqliteDataSource (local SQLite via better-sqlite3 or sql.js)
 * - NeonDataSource (remote PostgreSQL via @neondatabase/serverless)
 *
 * Design principles:
 * - Provider identity is explicit for logging
 * - Async operations for remote database compatibility
 * - Optional checkpoint for SQLite WAL mode
 * - Connection validation for remote databases
 */
export interface DataSourceProvider {
  // ===========================================================================
  // Identity
  // ===========================================================================

  /**
   * Unique identifier for this provider type
   * Examples: "sqlite", "neon", "turso"
   */
  readonly providerId: string;

  /**
   * Human-readable display name
   * Examples: "SQLite", "Neon PostgreSQL", "Turso"
   */
  readonly displayName: string;

  /**
   * Whether this is a remote database
   *
   * Remote databases:
   * - May have network latency
   * - Support multiple concurrent connections
   * - Should not be "nuked" without confirmation
   */
  readonly isRemote: boolean;

  // ===========================================================================
  // Database Access
  // ===========================================================================

  /**
   * Get the Drizzle database instance for queries
   *
   * This is the main entry point for all database operations.
   * Repositories use this to execute queries.
   */
  getDb(): DrizzleDatabase;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Run database migrations
   *
   * Applies pending migrations from the migrations folder.
   * For SQLite: uses drizzle-orm/better-sqlite3/migrator
   * For PostgreSQL: uses drizzle-orm/neon-serverless/migrator
   */
  runMigrations(): void;

  /**
   * Close the database connection
   *
   * Should be called on graceful shutdown to ensure
   * all writes are flushed and connections are released.
   */
  close(): void;

  // ===========================================================================
  // SQLite-Specific Operations (Optional)
  // ===========================================================================

  /**
   * Checkpoint WAL (Write-Ahead Log) to main database file
   *
   * SQLite-specific operation. For remote databases, this is a no-op.
   *
   * SQLite in WAL mode writes to a separate -wal file first.
   * This method flushes all pending writes to the main .db file,
   * ensuring a consistent state for backups.
   */
  checkpoint?(): void;

  // ===========================================================================
  // Connection Validation
  // ===========================================================================

  /**
   * Test the database connection
   *
   * For SQLite: Always succeeds if the database file is accessible
   * For remote databases: Tests network connectivity and authentication
   *
   * @returns Connection test result with latency for remote databases
   */
  testConnection(): Promise<ConnectionTestResult>;

  /**
   * Get connection information for display/logging
   *
   * Returns a human-readable description of the connection.
   * Sensitive information (passwords) should be masked.
   */
  getConnectionInfo(): ConnectionInfo;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown by DataSourceProvider operations
 */
export class DataSourceError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(`[${providerId}] ${operation}: ${message}`);
    this.name = "DataSourceError";
  }
}

/**
 * Error thrown when database connection fails
 */
export class ConnectionError extends DataSourceError {
  constructor(
    message: string,
    providerId: string,
    public readonly connectionInfo: string,
    cause?: Error
  ) {
    super(message, providerId, "connect", cause);
    this.name = "ConnectionError";
  }
}

/**
 * Error thrown when migrations fail
 */
export class MigrationError extends DataSourceError {
  constructor(message: string, providerId: string, cause?: Error) {
    super(message, providerId, "migrate", cause);
    this.name = "MigrationError";
  }
}
